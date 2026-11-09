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

function decodeImageBlob(imageBase64: string, mimeType: string) {
  const fileExtension = FILE_EXTENSION_BY_MIME_TYPE[mimeType];
  if (!fileExtension) throw new Error(`Unsupported image type: ${mimeType}`);
  const imageBytes = Utilities.base64Decode(imageBase64);
  return Utilities.newBlob(imageBytes, mimeType, `p5-sketch.${fileExtension}`);
}

// An image belongs to this add-on when its description is JSON with "p5slides": 1.
function isSketchDescription(description: string): boolean {
  try {
    const parsedDescription = JSON.parse(description);
    return parsedDescription !== null && typeof parsedDescription === 'object' && parsedDescription.p5slides === 1;
  } catch {
    return false;
  }
}

// Called from the dialog. Puts the image on the current slide and keeps the sketch settings
// (code included) in the image's alt-text description, so it can be re-edited later.
function insertSketch(imageBase64: string, mimeType: string, sketchJson: string) {
  const imageBlob = decodeImageBlob(imageBase64, mimeType);
  const currentPage = SlidesApp.getActivePresentation().getSelection().getCurrentPage();
  if (!currentPage) throw new Error('No slide is selected. Click a slide in the deck, then insert again.');

  const insertedImage = currentPage.insertImage(imageBlob);
  insertedImage.setDescription(sketchJson);
  return { objectId: insertedImage.getObjectId() };
}

// Called from the dialog. Returns the selected sketch image's settings, or null when the
// selection isn't exactly one image made by this add-on.
function getSelectedSketch() {
  const pageElementRange = SlidesApp.getActivePresentation().getSelection().getPageElementRange();
  if (!pageElementRange) return null;
  const selectedElements = pageElementRange.getPageElements();
  if (selectedElements.length !== 1) return null;
  const selectedElement = selectedElements[0];
  if (selectedElement.getPageElementType() !== SlidesApp.PageElementType.IMAGE) return null;

  const selectedImage = selectedElement.asImage();
  const description = selectedImage.getDescription();
  if (!isSketchDescription(description)) return null;
  return { objectId: selectedImage.getObjectId(), sketchJson: description };
}

// Called from the dialog. Swaps in the new image where the old one was (same position and size)
// and rewrites its description. The format may change, e.g. GIF to PNG.
function updateSketch(objectId: string, imageBase64: string, mimeType: string, sketchJson: string) {
  const imageBlob = decodeImageBlob(imageBase64, mimeType);
  const pageElement = SlidesApp.getActivePresentation().getPageElementById(objectId);
  if (!pageElement || pageElement.getPageElementType() !== SlidesApp.PageElementType.IMAGE) {
    throw new Error('The sketch image is no longer in the deck. Insert it as a new image instead.');
  }

  const replacedImage = pageElement.asImage().replace(imageBlob);
  replacedImage.setDescription(sketchJson);
  return { objectId: replacedImage.getObjectId() };
}
