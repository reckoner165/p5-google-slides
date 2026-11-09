// Phase 0 spike: throwaway. Proves dialog, srcdoc iframe, postMessage, and image insertion.

function onInstall(event) {
  onOpen(event);
}

function onOpen(event) {
  SlidesApp.getUi()
    .createAddonMenu()
    .addItem('Open spike', 'showSpikeDialog')
    .addToUi();
}

function showSpikeDialog() {
  const html = HtmlService.createHtmlOutputFromFile('spike')
    .setWidth(1000)
    .setHeight(650);
  SlidesApp.getUi().showModelessDialog(html, 'p5 Phase 0 spike');
}

// Spike 4: receives a base64 image from the dialog and inserts it on the current slide.
function insertSpikeImage(imageBase64, mimeType) {
  const startTime = Date.now();
  const extensionByMime = { 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg' };
  const extension = extensionByMime[mimeType];
  if (!extension) throw new Error('Unsupported mime type: ' + mimeType);

  const currentPage = SlidesApp.getActivePresentation().getSelection().getCurrentPage();
  if (!currentPage) throw new Error('No slide selected. Click a slide in the deck, then try again.');

  const bytes = Utilities.base64Decode(imageBase64);
  const decodedAt = Date.now();
  const blob = Utilities.newBlob(bytes, mimeType, 'p5-spike.' + extension);
  const image = currentPage.insertImage(blob);
  image.setDescription(JSON.stringify({ p5slides: 1, spike: true, format: extension }));
  const insertedAt = Date.now();

  return {
    receivedBase64Chars: imageBase64.length,
    decodedBytes: bytes.length,
    decodeMs: decodedAt - startTime,
    insertMs: insertedAt - decodedAt,
    objectId: image.getObjectId(),
    widthPt: image.getWidth(),
    heightPt: image.getHeight(),
  };
}
