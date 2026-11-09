import './style.css';
import { createEditor, getEditorCode, setEditorCode, STARTER_SKETCH } from './editor';
import { SketchRunner, type Capture, type RecordProgress, type SketchError } from './runner';
import { bytesToBase64, getSelectedSketch, insertSketch, resizeDialog, updateSketch, type SketchSettings } from './server';

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
const captureStatus = getElement<HTMLSpanElement>('capture-status');
const resultArea = getElement<HTMLDivElement>('result-area');
const resultPreview = getElement<HTMLImageElement>('result-preview');
const resultInfo = getElement<HTMLSpanElement>('result-info');
const insertButton = getElement<HTMLButtonElement>('insert-button');
const updateButton = getElement<HTMLButtonElement>('update-button');
const loadSelectedButton = getElement<HTMLButtonElement>('load-selected-button');
const collapseButton = getElement<HTMLButtonElement>('collapse-button');
const loadMessage = getElement<HTMLDivElement>('load-message');
const loadMessageText = getElement<HTMLSpanElement>('load-message-text');

// The latest capture, with the settings that produced it, waiting to be inserted.
let pendingCapture: { capture: Capture; settings: SketchSettings } | null = null;
let settingsForCaptureInProgress: SketchSettings | null = null;
// Set when a sketch was loaded from the deck, so Update can replace that image in place.
let loadedSketchObjectId: string | null = null;

function formatMegabytes(byteCount: number): string {
  return `${(byteCount / (1024 * 1024)).toFixed(2)} MB`;
}

function setCaptureStatus(statusText: string, isWarning = false): void {
  captureStatus.textContent = statusText;
  captureStatus.classList.toggle('warning', isWarning);
}

function showSketchError(sketchError: SketchError): void {
  const errorItem = document.createElement('li');
  errorItem.textContent = (sketchError.userCodeLine ? `Line ${sketchError.userCodeLine}: ` : '') + sketchError.message;
  errorList.appendChild(errorItem);
}

function showRecordProgress(progress: RecordProgress): void {
  const isLarge = progress.estimatedBytes > LARGE_IMAGE_BYTES;
  setCaptureStatus(
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
  setCaptureStatus('');
}

function showCaptureError(message: string): void {
  settingsForCaptureInProgress = null;
  captureButton.disabled = false;
  setCaptureStatus(message, true);
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
  setCaptureStatus('');
  sketchRunner.run(getEditorCode(editorView));
}

const editorView = createEditor(getElement('editor-host'), STARTER_SKETCH, runSketch);

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
    setCaptureStatus('Starting recording…');
    sketchRunner.record(settings.duration, settings.fps, scale);
  } else {
    if (format === 'jpeg') settings.jpegQuality = Number(jpegQualityInput.value);
    setCaptureStatus('Capturing…');
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
  setCaptureStatus(`${actionName} ${formatMegabytes(capture.bytes.length)}…`);
  try {
    const imageBase64 = await bytesToBase64(capture.bytes);
    if (destination === 'update' && loadedSketchObjectId) {
      await updateSketch(loadedSketchObjectId, imageBase64, capture.mimeType, settings);
      setCaptureStatus('Updated on the slide.');
    } else {
      await insertSketch(imageBase64, capture.mimeType, settings);
      setCaptureStatus('Inserted into the slide.');
    }
  } catch (error) {
    setCaptureStatus(error instanceof Error ? error.message : String(error), true);
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

// One line under the toolbar; the full text is in the tooltip when it doesn't fit.
function showLoadError(message: string | null): void {
  loadMessage.hidden = message === null;
  loadMessageText.textContent = message ?? '';
  loadMessage.title = message ?? '';
}

function setLoadingState(isLoading: boolean): void {
  loadSelectedButton.disabled = isLoading;
  loadSelectedButton.classList.toggle('is-loading', isLoading);
  loadSelectedButton.textContent = isLoading ? 'Loading' : 'Load selected';
}

// isAutomatic: true when called as the dialog opens, where "nothing selected" is not an error.
async function loadSelectedSketch(isAutomatic: boolean): Promise<void> {
  setLoadingState(true);
  showLoadError(null);
  try {
    const selectedSketch = await getSelectedSketch();
    if ('reason' in selectedSketch) {
      if (!isAutomatic) showLoadError(selectedSketch.reason);
      return;
    }
    loadedSketchObjectId = selectedSketch.objectId;
    setEditorCode(editorView, selectedSketch.settings.code);
    applySettingsToControls(selectedSketch.settings);
    pendingCapture = null;
    resultArea.hidden = true;
    runSketch();
    setCaptureStatus('Loaded the selected sketch. Capture it again, then Update on slide.');
  } catch (error) {
    if (!isAutomatic) showLoadError(error instanceof Error ? error.message : String(error));
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
getElement('run-button').addEventListener('click', runSketch);
getElement('stop-button').addEventListener('click', () => sketchRunner.pause());
loadSelectedButton.addEventListener('click', () => loadSelectedSketch(false));
formatSelect.addEventListener('change', updateFormatControls);
jpegQualityInput.addEventListener('input', () => {
  jpegQualityValue.textContent = Number(jpegQualityInput.value).toFixed(2);
});
captureButton.addEventListener('click', startCapture);
insertButton.addEventListener('click', () => sendPendingCapture('insert'));
updateButton.addEventListener('click', () => sendPendingCapture('update'));

updateFormatControls();
runSketch();
loadSelectedSketch(true);
