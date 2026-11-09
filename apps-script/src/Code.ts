// Server side of the p5 Sketches add-on. Compiled by esbuild without bundling,
// so every top-level function stays global, as Apps Script requires.

function onInstall(event: GoogleAppsScript.Events.AddonOnInstall) {
  onOpen(event);
}

function onOpen(_event?: unknown) {
  SlidesApp.getUi()
    .createAddonMenu()
    .addItem('Open editor', 'openEditor')
    .addToUi();
}

function openEditor() {
  const html = HtmlService.createHtmlOutputFromFile('dialog')
    .setWidth(1000)
    .setHeight(650);
  SlidesApp.getUi().showModelessDialog(html, 'p5 Sketch');
}

const FILE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/gif': 'gif',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

// Called from the dialog. Puts the image on the current slide and keeps the sketch settings
// (code included) in the image's alt-text description, so it can be re-edited later.
function insertSketch(imageBase64: string, mimeType: string, sketchJson: string) {
  const fileExtension = FILE_EXTENSION_BY_MIME_TYPE[mimeType];
  if (!fileExtension) throw new Error(`Unsupported image type: ${mimeType}`);

  const currentPage = SlidesApp.getActivePresentation().getSelection().getCurrentPage();
  if (!currentPage) throw new Error('No slide is selected. Click a slide in the deck, then insert again.');

  const imageBytes = Utilities.base64Decode(imageBase64);
  const imageBlob = Utilities.newBlob(imageBytes, mimeType, `p5-sketch.${fileExtension}`);
  const insertedImage = currentPage.insertImage(imageBlob);
  insertedImage.setDescription(sketchJson);
  return { objectId: insertedImage.getObjectId() };
}
