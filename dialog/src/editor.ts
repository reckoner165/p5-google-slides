import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';

export const STARTER_SKETCH = `function setup() {
  createCanvas(400, 400);
}

function draw() {
  background(240);
  fill(255, 0, 120);
  noStroke();
  circle(200 + 120 * cos(frameCount * 0.05), 200, 80);
}
`;

// Mod-Enter is Cmd+Enter on Mac, Ctrl+Enter elsewhere. Prec.highest beats basicSetup's own Mod-Enter binding.
export function createEditor(parentElement: HTMLElement, initialCode: string, onRunShortcut: () => void): EditorView {
  const runShortcut = Prec.highest(
    keymap.of([{ key: 'Mod-Enter', run: () => { onRunShortcut(); return true; } }]),
  );
  return new EditorView({
    doc: initialCode,
    parent: parentElement,
    extensions: [basicSetup, javascript(), runShortcut],
  });
}

export function getEditorCode(editorView: EditorView): string {
  return editorView.state.doc.toString();
}

export function setEditorCode(editorView: EditorView, code: string): void {
  editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: code } });
}
