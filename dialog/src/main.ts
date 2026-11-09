import './style.css';
import { createEditor, getEditorCode, STARTER_SKETCH } from './editor';
import { SketchRunner, type Capture, type RecordProgress, type SketchError } from './runner';
import { bytesToBase64, insertSketch, type SketchSettings } from './server';

const LARGE_IMAGE_BYTES = 5 * 1024 * 1024;

function getElement<ElementType extends HTMLElement>(elementId: string): ElementType {
  return document.getElementById(elementId) as ElementType;
}

const errorList = getElement<HTMLUListElement>('error-list');
const frameHost = getElement<HTMLDivElement>('frame-host');
const formatSelect = getElement<HTMLSelectElement>('format-select');
const scaleSelect = getElement<HTMLSelectElement>('scale-select');
const gifSettings = getElement<HTMLDivElement>('gif-settings');
const jpegSettings = getElement<HTMLDivElement>('jpeg-settings');
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

// The latest capture, with the settings that produced it, waiting to be inserted.
let pendingCapture: { capture: Capture; settings: SketchSettings } | null = null;
let settingsForCaptureInProgress: SketchSettings | null = null;

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
  gifSettings.hidden = format !== 'gif';
  jpegSettings.hidden = format !== 'jpeg';
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

async function insertPendingCapture(): Promise<void> {
  if (!pendingCapture) return;
  const { capture, settings } = pendingCapture;
  insertButton.disabled = true;
  setCaptureStatus(`Inserting ${formatMegabytes(capture.bytes.length)}…`);
  try {
    const imageBase64 = await bytesToBase64(capture.bytes);
    await insertSketch(imageBase64, capture.mimeType, settings);
    setCaptureStatus('Inserted into the slide.');
  } catch (error) {
    setCaptureStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    insertButton.disabled = false;
  }
}

getElement('run-button').addEventListener('click', runSketch);
getElement('stop-button').addEventListener('click', () => sketchRunner.pause());
formatSelect.addEventListener('change', updateFormatControls);
jpegQualityInput.addEventListener('input', () => {
  jpegQualityValue.textContent = Number(jpegQualityInput.value).toFixed(2);
});
captureButton.addEventListener('click', startCapture);
insertButton.addEventListener('click', insertPendingCapture);

updateFormatControls();
runSketch();
