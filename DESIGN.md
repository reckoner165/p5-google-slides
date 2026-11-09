# Design

How the editor dialog looks and behaves. It follows the p5.js web editor's visual language: flat
shapes, grey controls, and p5 magenta for anything active. All styles live in
`dialog/src/style.css`; markup is in `dialog/dialog.html`.

## Type

| Use | Font | Size |
|---|---|---|
| Everything in the dialog (labels, buttons, inputs, status) | Montserrat | 13px |
| Code editor | Inconsolata | 15px |
| Inline code in notes | Inconsolata | 12px |

Both fonts load from Google Fonts. Buttons, selects and inputs are set to `font: inherit` so they
use Montserrat too.

## Colour

| Role | Value |
|---|---|
| p5 magenta (active, primary, hover) | `#ed225d` |
| Magenta, pressed/hover on primary | `#c81a4d` |
| Neutral control fill (play, collapse) | `#d9d9d9` |
| Icon and text on neutral controls | `#333` |
| Labels, status text | `#555` |
| Secondary text (units, hints) | `#777` |
| Notes | `#888` |
| Borders | `#ccc` (controls), `#ddd` (panels), `#eee` (light dividers) |
| Errors and warnings | `#b00020` |
| Scrollbar thumb | `#8f8f8f`, hover `#777` |

## Buttons

- **Round buttons** (play, stop, collapse/expand): 44px circles, no border, icon centred.
  Play and collapse are grey `#d9d9d9` with a dark icon; stop is magenta with a white icon.
  Hover darkens slightly.
- **Pill button** (Load selected): 36px tall, fully rounded ends, fixed 136px wide so the label
  change to "Loading" doesn't move anything. While loading it shows "Loading" with dots that
  appear one at a time; the dots' space is always reserved.
- **Text buttons** (Snapshot / Record GIF): 32px tall, 4px corners, white with a grey border.
  Hover turns them magenta with white text.
- **Primary text buttons** (Insert into slide, Update on slide): magenta with white text; hover
  goes to the darker magenta.
- Disabled buttons drop to 50% opacity.

## Layout

### Full (1000 × 650)

- Left: code editor, then the error list and the `loadImage()` note underneath.
- Right column (440px): toolbar, status bar, live preview, export panel.
- The live preview matches the sketch's canvas size and scales down only to fit (max 400px tall).

### Compact (560 × 650)

Toggled by the collapse/expand button. The dialog resizes itself with
`google.script.host.setWidth/setHeight`.

```
toolbar          (play, stop, Load selected, expand)
status bar
editor
preview | export panel
```

The preview shrinks to a 120px live thumbnail. It stays visible on purpose: browsers stop
animating hidden cross-origin iframes, which would stall GIF recording.

### Export panel

A two-column CSS grid: labels in a 90px column, controls in a 160px column. Every select and
number input is 30px tall. Units ("seconds", "fps", the JPEG quality value) sit to the right of
their control inside the same cell. Rows that don't apply to the chosen format are hidden. The
Snapshot / Record GIF button spans the full width of the grid.

The captured result shows a small preview on the left, with its format, size and file size above
the Insert / Update buttons on the right.

## Status bar

One line directly under the toolbar is the dialog's only status area. Every message goes there:
loading, recording progress, inserting/updating, success, and errors.

- Normal messages: grey text, no icon.
- Errors and warnings: red, with a filled circle-exclamation icon.
- Always a single line. Long text ends in "…", and the full text is in the tooltip.

## Editor

- CodeMirror 6 with JavaScript highlighting.
- Cmd/Ctrl + Enter runs the sketch.
- Scrollbar: 11px flat grey thumb, square ends, no visible track (WebKit/Blink only; Firefox uses
  its default).
- Runtime errors appear under the editor in red monospace, with line numbers counted from the
  user's code.
