import { RECORDER_SCRIPT } from './recorder';

const P5_SCRIPT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js';

export interface SketchError {
  message: string;
  userCodeLine?: number; // 1-based line in the user's code, when known
}

export interface RecordProgress {
  framesWritten: number;
  totalFrames: number;
  estimatedBytes: number;
}

export interface Capture {
  mimeType: 'image/gif' | 'image/png' | 'image/jpeg';
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}

export interface RunnerHandlers {
  onSketchError: (sketchError: SketchError) => void;
  onRecordProgress: (progress: RecordProgress) => void;
  onCaptureDone: (capture: Capture) => void;
  onCaptureError: (message: string) => void;
}

// Runs inside the iframe before anything else. Forwards errors to the dialog.
const ERROR_BRIDGE_SCRIPT = `
window.onerror = function (message, source, line) {
  parent.postMessage({ type: 'sketch-error', message: String(message), line: line }, '*');
};
window.addEventListener('unhandledrejection', function (event) {
  var reason = event.reason;
  parent.postMessage({ type: 'sketch-error', message: 'Unhandled rejection: ' + (reason && reason.message ? reason.message : String(reason)) }, '*');
});
`;

function buildSrcdoc(userCode: string): { srcdoc: string; linesBeforeUserCode: number } {
  // A literal "</script" inside the user's code would end the script tag early.
  const safeUserCode = userCode.replace(/<\/script/gi, '<\\/script');
  const htmlBeforeUserCode = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<style>body { margin: 0; overflow: hidden; }</style>',
    '<script>' + ERROR_BRIDGE_SCRIPT + '</script>',
    `<script src="${P5_SCRIPT_URL}" crossorigin="anonymous"></script>`,
    '<script>' + RECORDER_SCRIPT + '</script>',
    '<script>',
  ].join('\n');
  const htmlAfterUserCode = ['</script>', '</head>', '<body></body>', '</html>'].join('\n');
  return {
    srcdoc: htmlBeforeUserCode + '\n' + safeUserCode + '\n' + htmlAfterUserCode,
    // Error line numbers count from the top of the srcdoc; this many lines come before the user's code.
    linesBeforeUserCode: htmlBeforeUserCode.split('\n').length,
  };
}

export class SketchRunner {
  private sketchFrame: HTMLIFrameElement | null = null;
  private linesBeforeUserCode = 0;
  private runningCode = '';
  private previewBounds = { maxWidth: Infinity, maxHeight: 400 };
  private lastCanvasSize: { width: number; height: number } | null = null;

  constructor(
    private readonly frameHost: HTMLElement,
    private readonly handlers: RunnerHandlers,
  ) {
    window.addEventListener('message', (event) => this.handleFrameMessage(event));
  }

  // The code the current preview is running, which can differ from the editor after edits.
  get lastRunCode(): string {
    return this.runningCode;
  }

  // A fresh iframe every run, so nothing leaks between runs.
  run(userCode: string): void {
    this.sketchFrame?.remove();
    const { srcdoc, linesBeforeUserCode } = buildSrcdoc(userCode);
    this.linesBeforeUserCode = linesBeforeUserCode;
    this.runningCode = userCode;
    const sketchFrame = document.createElement('iframe');
    sketchFrame.setAttribute('sandbox', 'allow-scripts');
    sketchFrame.srcdoc = srcdoc;
    this.frameHost.replaceChildren(sketchFrame);
    this.sketchFrame = sketchFrame;
  }

  // Freezes the sketch on its current frame. The iframe stays until the next run.
  pause(): void {
    this.sendToFrame({ type: 'pause' });
  }

  snapshot(mimeType: 'image/png' | 'image/jpeg', scale: number, jpegQuality: number): void {
    this.sendToFrame({ type: 'snapshot', mimeType, scale, jpegQuality });
  }

  record(durationSeconds: number, fps: number, scale: number): void {
    this.sendToFrame({ type: 'record', durationSeconds, fps, scale });
  }

  private sendToFrame(message: object): void {
    if (!this.sketchFrame?.contentWindow) {
      this.handlers.onCaptureError('Run the sketch first.');
      return;
    }
    this.sketchFrame.contentWindow.postMessage(message, '*');
  }

  // The largest size the preview may take up; the canvas is scaled down to fit inside it.
  setPreviewBounds(maxWidth: number, maxHeight: number): void {
    this.previewBounds = { maxWidth, maxHeight };
    if (this.lastCanvasSize) this.fitFrameToCanvas(this.lastCanvasSize.width, this.lastCanvasSize.height);
  }

  // Shows the canvas at its real size, scaled down only if it doesn't fit the preview area.
  private fitFrameToCanvas(canvasWidth: number, canvasHeight: number): void {
    this.lastCanvasSize = { width: canvasWidth, height: canvasHeight };
    if (!this.sketchFrame) return;
    const columnWidth = this.frameHost.parentElement?.clientWidth || canvasWidth;
    const availableWidth = Math.min(columnWidth, this.previewBounds.maxWidth);
    const previewScale = Math.min(1, availableWidth / canvasWidth, this.previewBounds.maxHeight / canvasHeight);
    this.sketchFrame.style.width = `${canvasWidth}px`;
    this.sketchFrame.style.height = `${canvasHeight}px`;
    this.sketchFrame.style.transform = `scale(${previewScale})`;
    this.frameHost.style.width = `${canvasWidth * previewScale}px`;
    this.frameHost.style.height = `${canvasHeight * previewScale}px`;
  }

  private handleFrameMessage(event: MessageEvent): void {
    if (!this.sketchFrame || event.source !== this.sketchFrame.contentWindow) return;
    const frameMessage = event.data;
    switch (frameMessage?.type) {
      case 'canvas-size':
        this.fitFrameToCanvas(frameMessage.width, frameMessage.height);
        break;
      case 'record-progress':
        this.handlers.onRecordProgress(frameMessage);
        break;
      case 'capture-done':
        this.handlers.onCaptureDone({
          mimeType: frameMessage.mimeType,
          bytes: new Uint8Array(frameMessage.buffer),
          width: frameMessage.width,
          height: frameMessage.height,
        });
        break;
      case 'capture-error':
        this.handlers.onCaptureError(frameMessage.message);
        break;
      case 'sketch-error': {
        const documentLine: number | undefined = frameMessage.line;
        const userCodeLine = documentLine ? documentLine - this.linesBeforeUserCode : undefined;
        this.handlers.onSketchError({
          message: frameMessage.message,
          // Errors thrown inside p5 or the recorder have lines outside the user's code; drop those.
          userCodeLine: userCodeLine && userCodeLine > 0 ? userCodeLine : undefined,
        });
        break;
      }
    }
  }
}
