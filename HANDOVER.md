# p5 Sketches for Google Slides: Build Handover

## Goal

A Google Slides editor add-on that lets you write and run p5.js sketches in a dialog next to the deck, export them as an **animated GIF** or a **still image (PNG or JPEG)**, and insert them into the current slide. Inserted sketches can be reopened, edited, re-rendered and swapped in place.

## Core constraint

Slides cannot run JavaScript inside a slide. A sketch can only live in a slide as an image, so the output is either an animated GIF (GIFs animate in both the editor and present mode) or a still PNG/JPEG. Live interactivity during a presentation is out of scope.

## Working agreement

- Describe the plan for each phase before writing code, and wait for a go-ahead.
- Do Phase 0 (spikes) first. If a spike fails, stop and report before building around it.
- Use clear, descriptive names; no single-letter variables outside trivial loops.

## Architecture

```
Slides editor
 └─ Add-on menu "p5 Sketch → Open editor"
     └─ Modeless dialog (HtmlService, ~1000×650)        ← UI: editor, controls, preview
         └─ Inner <iframe srcdoc> per run               ← p5 + user code + recorder
              │ postMessage: errors, GIF bytes
         ◄────┘
         └─ google.script.run.insertSketch(...)        ← Apps Script server
              └─ SlidesApp: insertImage / image.replace
```

- **Modeless dialog, not a sidebar.** Sidebars are fixed at 300px wide. A modeless dialog can be large and still lets the user click around the deck while it's open.
- **Fresh iframe per run.** Every Run destroys the previous iframe and builds a new one with `srcdoc`, so no state leaks between runs. p5 loads from a pinned CDN URL (cdnjs or jsDelivr, a specific 1.x version).
- **Sketch source travels with the image.** It's stored as JSON in the image's alt-text description (`setDescription`), so it survives slide duplication and copying between decks.

## Stack and tooling

- Apps Script standalone project, developed locally with **clasp**, server code in TypeScript.
- Dialog UI: **TypeScript + Vite**, bundled into one HTML file with **vite-plugin-singlefile**. HtmlService only serves single files.
- Editor: **CodeMirror 6** with JavaScript language support.
- GIF encoding: **gifenc** (`GIFEncoder`, `quantize`, `applyPalette`).
- OAuth scope: **`https://www.googleapis.com/auth/presentations.currentonly`** only. Add others only if something truly needs them, and say why.

## Suggested layout

```
/apps-script/        Code.ts (menu, dialog, server functions), appsscript.json
/dialog/             Vite project for the dialog UI
  src/main.ts        UI wiring
  src/editor.ts      CodeMirror setup
  src/runner.ts      builds srcdoc, manages iframe lifecycle, message handling
  src/recorder.ts    script injected into the iframe (frame capture + gifenc)
  src/server.ts      typed wrappers around google.script.run
/build script        builds dialog → copies single HTML into /apps-script → clasp push
```

## Phase 0: Spikes (de-risk first)

Prove each of these works inside a real Slides test deployment before building features:

1. A modeless dialog opens from the add-on menu, and the deck stays usable while it's open.
2. A `srcdoc` iframe inside the HtmlService dialog loads p5 from the CDN and runs a sketch.
3. `postMessage` works in both directions between the dialog and the inner iframe.
4. A ~2MB base64 string passes through `google.script.run`, and `insertImage(blob)` produces an animated GIF on the slide. Also confirm PNG and JPEG blobs insert correctly.

## Phase 1: Skeleton

- clasp project, `appsscript.json` with the single scope.
- `onOpen` / `onInstall` → `createAddonMenu()` → "Open editor" → `showModelessDialog`.
- Vite single-file build piped into the Apps Script project, with a one-command `push`.

**Done when:** the menu opens a dialog that says "hello" in a real deck.

## Phase 2: Editor and runner

- CodeMirror editor preloaded with a starter sketch (`setup`/`draw`, 400×400 canvas).
- **Run** builds a new iframe: p5 `<script>` + recorder script + user code. **Stop** removes the iframe.
- Inside the iframe, `window.onerror` and `unhandledrejection` forward errors via `postMessage`. The dialog shows them under the editor.
- Cmd/Ctrl+Enter runs.

**Done when:** you can edit, run, stop, and see runtime errors.

## Phase 3: Capture

The UI has an **output format** selector: GIF, PNG, or JPEG.

### Still image (PNG / JPEG)

- A **Snapshot** button captures the current frame of the running sketch, so the user picks the moment.
- In the iframe, draw the main canvas onto an offscreen 2D canvas at the chosen scale, then `toBlob('image/png')` or `toBlob('image/jpeg', quality)`. Expose a **JPEG quality** slider.
- For JPEG, fill the offscreen canvas with white first, since JPEG has no transparency.
- Post the bytes back and show a preview in the dialog.

**Done when:** Snapshot produces a correct PNG and JPEG preview of the frame on screen.

### Animated GIF

- Don't use p5's `saveGif()`. It forces a download and doesn't hand back bytes.
- The recorder hooks into p5 after each frame with `p5.prototype.registerMethod('post', ...)`. Each frame it draws the main canvas onto an offscreen 2D canvas at the chosen scale, so the same code handles WEBGL sketches and resizing. Then it reads the pixels with `getImageData`.
- Encode with gifenc: quantize each frame, `writeFrame` with the delay that matches the chosen fps.
- UI controls: **duration** (seconds), **fps**, **scale**. Show an estimated output size and warn above ~5MB.
- When done, the iframe posts the GIF bytes back. The dialog shows a preview of the GIF before insertion.

**Done when:** a 3s, 15fps, 400px sketch produces a correct looping GIF preview in the dialog.

## Phase 4: Insert into slide

- Dialog base64-encodes the image and calls `insertSketch(imageBase64, mimeType, sketchJson)`, where `mimeType` is `image/gif`, `image/png` or `image/jpeg`.
- Server: `Utilities.base64Decode` → `Utilities.newBlob(bytes, mimeType, 'p5-sketch.<ext>')` → `getSelection().getCurrentPage().insertImage(blob)` → `image.setDescription(sketchJson)`.
- `sketchJson` = `{ "p5slides": 1, "code": "...", "format": "gif" | "png" | "jpeg", "duration": 3, "fps": 15, "scale": 1, "jpegQuality": 0.9 }`. Only the fields relevant to the format need values. The `p5slides` key identifies images the add-on owns.
- Handle the case where no page is selected with a clear message.
- Keep within insertImage limits: under 50MB and 25 megapixels.

**Done when:** a recorded sketch lands on the current slide and its description holds the JSON.

## Phase 5: Re-edit

- A **Load selected** button calls `getSelectedSketch()` on the server. It checks the selected page element, confirms it's an image with a `p5slides` JSON description, and returns the JSON.
- Do this on dialog open too, when something is selected. Restore the code, the output format and its settings.
- **Update** re-captures (snapshot or recording, depending on format) and calls `updateSketch(objectId, imageBase64, mimeType, sketchJson)`, which does `image.replace(blob)` (keeps position and size) and rewrites the description. Switching format on update (e.g. GIF → PNG) is allowed.

**Done when:** you can select an inserted sketch, change the code, and update it in place.

## Phase 6: Polish

- Remember the last unsaved sketch in the dialog (localStorage, wrapped in try/catch).
- Progress indicator during recording and insertion.
- `loadImage()` from external URLs will mostly fail on cross-origin restrictions. For v1, document this in the UI rather than solving it.

## Phase 7: Test and ship

- Use **Deploy → Test deployments** on a real deck throughout.
- To publish, link to a Google Cloud project, configure the OAuth consent screen and Marketplace SDK listing, then submit for review. The `currentonly` scope keeps verification light.

## Out of scope for v1

- Live interactive sketches during presentations.
- Video (MP4/WebM) output.
- Loading external assets.
- p5 instance mode or libraries beyond core p5.
