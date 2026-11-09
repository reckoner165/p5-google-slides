// Plain JS injected into the sketch iframe after p5 loads and before the user's code.
// It reports the canvas size, pauses on request, and captures snapshots and GIFs.
// Keep the text free of "</script" and backticks: it is pasted into the srcdoc as-is.
export const RECORDER_SCRIPT = `
var GIFENC_MODULE_URL = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm';
var reportedCanvasSize = '';
var activeRecording = null;

function sendToDialog(message, transferList) {
  parent.postMessage(message, '*', transferList || []);
}

function getMainCanvas() {
  return document.getElementById('defaultCanvas0') || document.querySelector('canvas');
}

function createScaledCanvas(scale) {
  var scaledCanvas = document.createElement('canvas');
  scaledCanvas.width = Math.max(1, Math.round(width * scale));
  scaledCanvas.height = Math.max(1, Math.round(height * scale));
  return scaledCanvas;
}

// Drawing onto a separate 2D canvas handles WEBGL sketches, pixel density and scaling the same way.
// White underneath, because GIF and JPEG have no real transparency.
function drawScaledFrame(scaledCanvas) {
  var context = scaledCanvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, scaledCanvas.width, scaledCanvas.height);
  context.drawImage(getMainCanvas(), 0, 0, scaledCanvas.width, scaledCanvas.height);
  return context;
}

function sendCapture(mimeType, buffer, scaledCanvas) {
  sendToDialog({
    type: 'capture-done', mimeType: mimeType, buffer: buffer,
    width: scaledCanvas.width, height: scaledCanvas.height
  }, [buffer]);
}

function takeSnapshot(request) {
  if (!getMainCanvas()) { sendToDialog({ type: 'capture-error', message: 'The sketch has no canvas yet.' }); return; }
  var scaledCanvas = createScaledCanvas(request.scale);
  var context = scaledCanvas.getContext('2d');
  if (request.mimeType === 'image/jpeg') {
    drawScaledFrame(scaledCanvas);
  } else {
    context.drawImage(getMainCanvas(), 0, 0, scaledCanvas.width, scaledCanvas.height);
  }
  scaledCanvas.toBlob(function (imageBlob) {
    if (!imageBlob) { sendToDialog({ type: 'capture-error', message: 'The browser could not encode the image.' }); return; }
    imageBlob.arrayBuffer().then(function (buffer) { sendCapture(request.mimeType, buffer, scaledCanvas); });
  }, request.mimeType, request.jpegQuality);
}

function startRecording(request) {
  if (!getMainCanvas()) { sendToDialog({ type: 'capture-error', message: 'The sketch has no canvas yet.' }); return; }
  import(GIFENC_MODULE_URL).then(function (gifenc) {
    activeRecording = {
      gifenc: gifenc,
      encoder: gifenc.GIFEncoder(),
      scaledCanvas: createScaledCanvas(request.scale),
      totalFrames: Math.max(1, Math.round(request.durationSeconds * request.fps)),
      frameDelayMs: Math.round(1000 / request.fps),
      framesWritten: 0,
      previousFrameRate: typeof getTargetFrameRate === 'function' ? getTargetFrameRate() : 60
    };
    // One draw() per GIF frame, so frameCount-based animation plays back at the right speed.
    frameRate(request.fps);
    if (!isLooping()) loop();
  }).catch(function (error) {
    sendToDialog({ type: 'capture-error', message: 'Could not load the GIF encoder: ' + (error && error.message ? error.message : error) });
  });
}

function endRecording() {
  var recording = activeRecording;
  activeRecording = null;
  frameRate(recording.previousFrameRate);
  return recording;
}

function captureGifFrame() {
  var recording = activeRecording;
  var scaledCanvas = recording.scaledCanvas;
  var context = drawScaledFrame(scaledCanvas);
  var rgba = context.getImageData(0, 0, scaledCanvas.width, scaledCanvas.height).data;
  var palette = recording.gifenc.quantize(rgba, 256);
  var indexedPixels = recording.gifenc.applyPalette(rgba, palette);
  recording.encoder.writeFrame(indexedPixels, scaledCanvas.width, scaledCanvas.height, { palette: palette, delay: recording.frameDelayMs });
  recording.framesWritten++;
  var bytesSoFar = recording.encoder.bytesView().length;
  sendToDialog({
    type: 'record-progress',
    framesWritten: recording.framesWritten,
    totalFrames: recording.totalFrames,
    estimatedBytes: Math.round(bytesSoFar / recording.framesWritten * recording.totalFrames)
  });
  if (recording.framesWritten >= recording.totalFrames) {
    endRecording();
    recording.encoder.finish();
    var gifBytes = recording.encoder.bytes();
    sendCapture('image/gif', gifBytes.buffer, scaledCanvas);
  }
}

p5.prototype.registerMethod('post', function () {
  var canvasSize = this.width + 'x' + this.height;
  if (canvasSize !== reportedCanvasSize) {
    reportedCanvasSize = canvasSize;
    sendToDialog({ type: 'canvas-size', width: this.width, height: this.height });
  }
  if (activeRecording) captureGifFrame();
});

window.addEventListener('message', function (event) {
  if (event.source !== parent || !event.data) return;
  var request = event.data;
  if (request.type === 'pause') {
    if (activeRecording) {
      endRecording();
      sendToDialog({ type: 'capture-error', message: 'Recording stopped before it finished.' });
    }
    noLoop();
  } else if (request.type === 'snapshot') {
    takeSnapshot(request);
  } else if (request.type === 'record') {
    startRecording(request);
  }
});
`;
