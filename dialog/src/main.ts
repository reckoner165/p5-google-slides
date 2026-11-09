import './style.css';
import { createEditor, getEditorCode, setEditorCode, STARTER_SKETCH } from './editor';
import { SketchRunner, type Capture, type RecordProgress, type SketchError } from './runner';
import {
  bytesToBase64,
  getSelectedSketch,
  insertSketch,
  resizeDialog,
  updateSketch,
  type SelectedSketch,
  type SketchSettings,
} from './server';

const LARGE_IMAGE_BYTES = 5 * 1024 * 1024;
// FULL matches openEditor() in Code.ts.
const FULL_DIALOG_SIZE = { width: 1000, height: 650 };
const COMPACT_DIALOG_SIZE = { width: 560, height: 650 };
const COMPACT_PREVIEW_SIZE = 120;

function getElement<ElementType extends HTMLElement>(elementId: string): ElementType {
  return document.getElementById(elementId) as ElementType;
}

const errorList = getElement<HTMLUListElement>('error-list');
const frameHost = getElement<HTMLDivElement>('frame-host');
const formatSelect = getElement<HTMLSelectElement>('format-select');
const scaleSelect = getElement<HTMLSelectElement>('scale-select');
const durationRow = getElement<HTMLDivElement>('duration-row');
const fpsRow = getElement<HTMLDivElement>('fps-row');
const jpegQualityRow = getElement<HTMLDivElement>('jpeg-quality-row');
const durationInput = getElement<HTMLInputElement>('duration-input');
const fpsInput = getElement<HTMLInputElement>('fps-input');
const jpegQualityInput = getElement<HTMLInputElement>('jpeg-quality-input');
const jpegQualityValue = getElement<HTMLSpanElement>('jpeg-quality-value');
const captureButton = getElement<HTMLButtonElement>('capture-button');
const resultArea = getElement<HTMLDivElement>('result-area');
const resultPreview = getElement<HTMLImageElement>('result-preview');
const resultInfo = getElement<HTMLSpanElement>('result-info');
const insertButton = getElement<HTMLButtonElement>('insert-button');
const updateButton = getElement<HTMLButtonElement>('update-button');
const loadSelectedButton = getElement<HTMLButtonElement>('load-selected-button');
const collapseButton = getElement<HTMLButtonElement>('collapse-button');
const statusBar = getElement<HTMLDivElement>('status-bar');
const statusBarText = getElement<HTMLSpanElement>('status-bar-text');
const statusBarActions = getElement<HTMLSpanElement>('status-bar-actions');

// The latest capture, with the settings that produced it, waiting to be inserted.
let pendingCapture: { capture: Capture; settings: SketchSettings } | null = null;
let settingsForCaptureInProgress: SketchSettings | null = null;
// Set when a sketch was loaded from the deck, so Update can replace that image in place.
let loadedSketchObjectId: string | null = null;

function formatMegabytes(byteCount: number): string {
  return `${(byteCount / (1024 * 1024)).toFixed(2)} MB`;
}

interface StatusAction {
  label: string;
  onClick: () => void;
}

// The one status line under the toolbar. Empty text hides it; errors and warnings show red with
// an icon. The full text is in the tooltip when it doesn't fit on one line. Optional action
// buttons sit at the end of the line, e.g. Replace / Cancel.
function setStatus(statusText: string, isError = false, statusActions: StatusAction[] = []): void {
  statusBar.hidden = statusText === '';
  statusBar.classList.toggle('is-error', isError);
  statusBarText.textContent = statusText;
  statusBar.title = statusText;
  statusBarActions.replaceChildren(
    ...statusActions.map((statusAction) => {
      const actionButton = document.createElement('button');
      actionButton.className = 'text-button status-action';
      actionButton.textContent = statusAction.label;
      actionButton.addEventListener('click', statusAction.onClick);
      return actionButton;
    }),
  );
}

function showSketchError(sketchError: SketchError): void {
  const errorItem = document.createElement('li');
  errorItem.textContent = (sketchError.userCodeLine ? `Line ${sketchError.userCodeLine}: ` : '') + sketchError.message;
  errorList.appendChild(errorItem);
}

function showRecordProgress(progress: RecordProgress): void {
  const isLarge = progress.estimatedBytes > LARGE_IMAGE_BYTES;
  setStatus(
    `Recording ${progress.framesWritten}/${progress.totalFrames} frames · about ${formatMegabytes(progress.estimatedBytes)}` +
      (isLarge ? ' (over 5 MB: inserting will be slow)' : ''),
    isLarge,
  );
}

function showCapture(capture: Capture): void {
  if (!settingsForCaptureInProgress) return;
  pendingCapture = { capture, settings: settingsForCaptureInProgress };
  settingsForCaptureInProgress = null;
  captureButton.disabled = false;
  if (resultPreview.src) URL.revokeObjectURL(resultPreview.src);
  resultPreview.src = URL.createObjectURL(new Blob([capture.bytes], { type: capture.mimeType }));
  const formatName = pendingCapture.settings.format.toUpperCase();
  const isLarge = capture.bytes.length > LARGE_IMAGE_BYTES;
  resultInfo.textContent = `${formatName} · ${capture.width}×${capture.height} · ${formatMegabytes(capture.bytes.length)}`;
  resultInfo.classList.toggle('warning', isLarge);
  resultArea.hidden = false;
  insertButton.disabled = false;
  updateButton.hidden = loadedSketchObjectId === null;
  updateButton.disabled = false;
  setStatus('');
}

function showCaptureError(message: string): void {
  settingsForCaptureInProgress = null;
  captureButton.disabled = false;
  setStatus(message, true);
}

const sketchRunner = new SketchRunner(frameHost, {
  onSketchError: showSketchError,
  onRecordProgress: showRecordProgress,
  onCaptureDone: showCapture,
  onCaptureError: showCaptureError,
});

function runSketch(): void {
  errorList.replaceChildren();
  settingsForCaptureInProgress = null;
  captureButton.disabled = false;
  setStatus('');
  sketchRunner.run(getEditorCode(editorView));
}

// The editor's code is kept in this browser's storage so closing the dialog doesn't lose it.
// Storage can be blocked (private windows, site settings), so every access is wrapped.
const SAVED_CODE_STORAGE_KEY = 'p5slides.unsavedCode';
// The code most recently loaded from, inserted into, or updated on a slide. Editor code that
// matches it (or the starter sketch) is safe to replace without asking.
const PLACED_CODE_STORAGE_KEY = 'p5slides.placedCode';
const SAVE_DELAY_MS = 400;
let pendingSaveTimer: number | undefined;

function readStoredText(storageKey: string): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeStoredText(storageKey: string, text: string): void {
  try {
    localStorage.setItem(storageKey, text);
  } catch {
    // Storage unavailable: the text just won't be remembered.
  }
}

function saveCodeSoon(code: string): void {
  window.clearTimeout(pendingSaveTimer);
  pendingSaveTimer = window.setTimeout(() => writeStoredText(SAVED_CODE_STORAGE_KEY, code), SAVE_DELAY_MS);
}

let placedCode = readStoredText(PLACED_CODE_STORAGE_KEY);

function rememberPlacedCode(code: string): void {
  placedCode = code;
  writeStoredText(PLACED_CODE_STORAGE_KEY, code);
}

const editorView = createEditor(
  getElement('editor-host'),
  readStoredText(SAVED_CODE_STORAGE_KEY) ?? STARTER_SKETCH,
  runSketch,
  saveCodeSoon,
);

function hasUnplacedCode(): boolean {
  const editorCode = getEditorCode(editorView);
  return editorCode !== STARTER_SKETCH && editorCode !== placedCode;
}

function updateFormatControls(): void {
  const format = formatSelect.value;
  durationRow.hidden = format !== 'gif';
  fpsRow.hidden = format !== 'gif';
  jpegQualityRow.hidden = format !== 'jpeg';
  captureButton.textContent = format === 'gif' ? 'Record GIF' : 'Snapshot';
}

function startCapture(): void {
  const format = formatSelect.value as SketchSettings['format'];
  const scale = Number(scaleSelect.value);
  const settings: SketchSettings = { p5slides: 1, code: sketchRunner.lastRunCode, format, scale };
  captureButton.disabled = true;
  settingsForCaptureInProgress = settings;
  if (format === 'gif') {
    settings.duration = Number(durationInput.value);
    settings.fps = Number(fpsInput.value);
    setStatus('Starting recording…');
    sketchRunner.record(settings.duration, settings.fps, scale);
  } else {
    if (format === 'jpeg') settings.jpegQuality = Number(jpegQualityInput.value);
    setStatus('Capturing…');
    sketchRunner.snapshot(format === 'png' ? 'image/png' : 'image/jpeg', scale, settings.jpegQuality ?? 0.9);
  }
}

// Sends the pending capture to the deck: a new image, or a replacement for the loaded sketch.
async function sendPendingCapture(destination: 'insert' | 'update'): Promise<void> {
  if (!pendingCapture) return;
  const { capture, settings } = pendingCapture;
  insertButton.disabled = true;
  updateButton.disabled = true;
  const actionName = destination === 'insert' ? 'Inserting' : 'Updating';
  setStatus(`${actionName} ${formatMegabytes(capture.bytes.length)}…`);
  try {
    const imageBase64 = await bytesToBase64(capture.bytes);
    if (destination === 'update' && loadedSketchObjectId) {
      await updateSketch(loadedSketchObjectId, imageBase64, capture.mimeType, settings);
      setStatus('Updated on the slide.');
    } else {
      await insertSketch(imageBase64, capture.mimeType, settings);
      setStatus('Inserted into the slide.');
    }
    rememberPlacedCode(settings.code);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    insertButton.disabled = false;
    updateButton.disabled = false;
  }
}

function applySettingsToControls(settings: SketchSettings): void {
  formatSelect.value = settings.format;
  if (Array.from(scaleSelect.options).some((option) => Number(option.value) === settings.scale)) {
    scaleSelect.value = String(settings.scale);
  }
  if (settings.duration !== undefined) durationInput.value = String(settings.duration);
  if (settings.fps !== undefined) fpsInput.value = String(settings.fps);
  if (settings.jpegQuality !== undefined) {
    jpegQualityInput.value = String(settings.jpegQuality);
    jpegQualityValue.textContent = settings.jpegQuality.toFixed(2);
  }
  updateFormatControls();
}

function setLoadingState(isLoading: boolean): void {
  loadSelectedButton.disabled = isLoading;
  loadSelectedButton.classList.toggle('is-loading', isLoading);
  loadSelectedButton.textContent = isLoading ? 'Loading' : 'Load selected';
}

function applyLoadedSketch(selectedSketch: SelectedSketch): void {
  loadedSketchObjectId = selectedSketch.objectId;
  setEditorCode(editorView, selectedSketch.settings.code);
  rememberPlacedCode(selectedSketch.settings.code);
  applySettingsToControls(selectedSketch.settings);
  pendingCapture = null;
  resultArea.hidden = true;
  runSketch();
  setStatus('Loaded the selected sketch. Capture it again, then Update on slide.');
}

// isAutomatic: true when called as the dialog opens, where "nothing selected" is not an error.
// replaceConfirmed: true when the user already agreed to replace their code (or there was nothing
// to lose), so there's no need to ask again after the selection comes back.
async function loadSelectedSketch(isAutomatic: boolean, replaceConfirmed: boolean): Promise<void> {
  setLoadingState(true);
  setStatus('');
  try {
    const selectedSketch = await getSelectedSketch();
    if ('reason' in selectedSketch) {
      if (!isAutomatic) setStatus(selectedSketch.reason, true);
      return;
    }
    const isSameCode = getEditorCode(editorView) === selectedSketch.settings.code;
    if (!replaceConfirmed && hasUnplacedCode() && !isSameCode) {
      setStatus('Replace code that isn’t on a slide yet?', true, [
        { label: 'Replace', onClick: () => applyLoadedSketch(selectedSketch) },
        { label: 'Cancel', onClick: () => setStatus('Kept your code. The selected sketch wasn’t loaded.') },
      ]);
      return;
    }
    applyLoadedSketch(selectedSketch);
  } catch (error) {
    if (!isAutomatic) setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setLoadingState(false);
  }
}

// Compact: a narrower dialog with code and export, so more of the slide is reachable.
function setCompactLayout(isCompact: boolean): void {
  document.body.classList.toggle('compact', isCompact);
  const dialogSize = isCompact ? COMPACT_DIALOG_SIZE : FULL_DIALOG_SIZE;
  resizeDialog(dialogSize.width, dialogSize.height);
  if (isCompact) {
    sketchRunner.setPreviewBounds(COMPACT_PREVIEW_SIZE, COMPACT_PREVIEW_SIZE);
  } else {
    sketchRunner.setPreviewBounds(Infinity, 400);
  }
  const buttonLabel = isCompact ? 'Expand' : 'Collapse';
  collapseButton.setAttribute('aria-label', buttonLabel);
  collapseButton.title = isCompact ? 'Expand to full editor' : 'Collapse to code and export';
}

collapseButton.addEventListener('click', () => setCompactLayout(!document.body.classList.contains('compact')));
getElement('info-button').addEventListener('click', () => (getElement('info-page').hidden = false));
getElement('info-back-button').addEventListener('click', () => (getElement('info-page').hidden = true));
getElement('run-button').addEventListener('click', runSketch);
getElement('stop-button').addEventListener('click', () => sketchRunner.pause());
// A click asks about unsaved code before contacting Slides, so the question comes up right away.
loadSelectedButton.addEventListener('click', () => {
  if (!hasUnplacedCode()) {
    loadSelectedSketch(false, true);
    return;
  }
  setStatus('Replace code that isn’t on a slide yet?', true, [
    { label: 'Replace', onClick: () => loadSelectedSketch(false, true) },
    { label: 'Cancel', onClick: () => setStatus('Kept your code. Nothing was loaded.') },
  ]);
});
formatSelect.addEventListener('change', updateFormatControls);
jpegQualityInput.addEventListener('input', () => {
  jpegQualityValue.textContent = Number(jpegQualityInput.value).toFixed(2);
});
captureButton.addEventListener('click', startCapture);
insertButton.addEventListener('click', () => sendPendingCapture('insert'));
updateButton.addEventListener('click', () => sendPendingCapture('update'));

updateFormatControls();
runSketch();
// On open, check the selection first: asking before knowing a sketch is selected would prompt
// every time the dialog opens.
loadSelectedSketch(true, false);
