# p5 Sketches for Slides

A Google Slides editor add-on for writing and running p5.js sketches next to your deck, then
putting them on a slide as an animated GIF or a still PNG/JPEG. Sketches you insert can be
reopened, edited and updated in place.

Slides can't run JavaScript inside a slide, so a sketch lives on the slide as an image. GIFs
animate both in the editor and in present mode. Live interactivity during a presentation is out
of scope.

## Using it

1. In a deck, open **Extensions → (add-on name) → Open editor**.
2. Write a sketch. **Run** (or Cmd/Ctrl + Enter) starts it, **Stop** freezes it on the current
   frame.
3. Pick a format:
   - **GIF:** set duration, frame rate and scale, then **Record GIF**.
   - **PNG / JPEG:** set scale (and quality for JPEG), then **Snapshot** to grab the current frame.
4. Click a slide in the deck, then **Insert into slide**.

To edit a sketch that's already on a slide, select the image and open the editor (or click
**Load selected**). Its code and settings come back. Capture again, then **Update on slide**:
the image is replaced in place, keeping its position and size.

The collapse button shrinks the dialog to code and export only, so you can reach the slide
behind it.

Your code is remembered in the browser between openings of the dialog.

### Limits

- `loadImage()` from other websites usually fails, because most sites block it.
- GIFs over about 5 MB are slow to insert; the dialog warns while recording.
- Sketches with heavy per-pixel noise record slowly, because each frame's colours are reduced to
  a 256-colour palette while the sketch runs.

## How it works

```
Slides editor
 └─ Add-on menu → Open editor
     └─ Modeless dialog (HtmlService)            editor, controls, preview
         └─ Sandboxed <iframe srcdoc> per run    p5 + recorder + your code
              │ postMessage: errors, canvas size, captured image bytes
         ◄────┘
         └─ google.script.run                    insertSketch / getSelectedSketch / updateSketch
              └─ SlidesApp: insertImage, image.replace, setDescription
```

- Every Run builds a fresh iframe, so nothing carries over between runs.
- The sketch's code and export settings are saved as JSON in the image's alt-text description
  (`{"p5slides": 1, "code": "...", "format": "gif", ...}`), so the sketch travels with the image.
  That's how **Load selected** finds it.
- p5.js 1.9.4 loads from cdnjs, the GIF encoder (gifenc 1.0.3) from jsDelivr, and the fonts from
  Google Fonts.
- OAuth scopes: `presentations.currentonly` (only the deck the add-on is open in) and
  `script.container.ui` (needed to show the dialog).

## Project layout

```
apps-script/
  src/Code.ts         server: menu, dialog, insert / load / update
  appsscript.json     manifest (scopes)
  .clasp.json         which Apps Script project to push to; uploads dist/ only
  dist/               build output that gets pushed (git-ignored)
dialog/
  dialog.html         dialog markup
  src/main.ts         UI wiring
  src/editor.ts       CodeMirror setup
  src/runner.ts       builds the iframe, handles its messages
  src/recorder.ts     script injected into the iframe: snapshots and GIF recording
  src/server.ts       typed wrappers around google.script.run
  src/style.css       styles (see DESIGN.md)
spikes/phase0/        the original feasibility spike (kept for reference)
HANDOVER.md           the v1 plan
DESIGN.md             visual design
```

## Development

Requirements: Node 20+, and clasp (`npm i -g @google/clasp`).

```
npm install
clasp login          # needs only "Create and update Google Apps Script projects"
                     # and "...only the specific Google Drive files you use with this app"
npm run build        # type-check, bundle the dialog into one HTML file, compile the server
npm run push         # build, then upload apps-script/dist to the Apps Script project
```

The Apps Script API must be turned on at https://script.google.com/home/usersettings.

### Testing in a deck

1. Open the Apps Script project, then **Deploy → Test deployments**.
2. Add a test with type **Editor Add-on**, version **Latest code**, config **Installed and
   enabled**, and pick a test deck.
3. **Execute** opens the deck with the add-on installed. After each `npm run push`, execute again
   to pick up the new code.
