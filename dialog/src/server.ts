// Typed wrappers around google.script.run, which only exists inside the Apps Script dialog.

export interface SketchSettings {
  p5slides: 1; // marks images this add-on owns
  code: string;
  format: 'gif' | 'png' | 'jpeg';
  scale: number;
  duration?: number;
  fps?: number;
  jpegQuality?: number;
}

export interface InsertResult {
  objectId: string;
}

interface ScriptRunner {
  withSuccessHandler(handler: (result: unknown) => void): ScriptRunner;
  withFailureHandler(handler: (error: Error) => void): ScriptRunner;
  [serverFunctionName: string]: unknown;
}

function callServer<Result>(serverFunctionName: string, ...serverArguments: unknown[]): Promise<Result> {
  const appsScript = (window as unknown as { google?: { script: { run: ScriptRunner } } }).google;
  if (!appsScript) return Promise.reject(new Error('Not running inside Google Slides.'));
  return new Promise((resolve, reject) => {
    const scriptRunner = appsScript.script.run
      .withSuccessHandler((result) => resolve(result as Result))
      .withFailureHandler(reject);
    (scriptRunner[serverFunctionName] as (...callArguments: unknown[]) => void)(...serverArguments);
  });
}

export function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes]));
  });
}

export function insertSketch(imageBase64: string, mimeType: string, settings: SketchSettings): Promise<InsertResult> {
  return callServer<InsertResult>('insertSketch', imageBase64, mimeType, JSON.stringify(settings));
}

export interface SelectedSketch {
  objectId: string;
  settings: SketchSettings;
}

export async function getSelectedSketch(): Promise<SelectedSketch | null> {
  const selection = await callServer<{ objectId: string; sketchJson: string } | null>('getSelectedSketch');
  if (!selection) return null;
  return { objectId: selection.objectId, settings: JSON.parse(selection.sketchJson) as SketchSettings };
}

export function updateSketch(
  objectId: string,
  imageBase64: string,
  mimeType: string,
  settings: SketchSettings,
): Promise<InsertResult> {
  return callServer<InsertResult>('updateSketch', objectId, imageBase64, mimeType, JSON.stringify(settings));
}
