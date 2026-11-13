import type { FaceBox } from '../face';
import { detectFacesWith, farDescriptorsWith, type DetectedFace, type FaceApi } from './faceDetect';

/**
 * Browser-only, on-device face detection and 128-number descriptors (face-api.js,
 * MIT). Frames never leave this tab; only descriptors of opted-in scans are saved.
 * Loaded lazily so the rest of the app never downloads TensorFlow or the models.
 */
export type { DetectedFace };

let engine: Promise<FaceApi> | null = null;
/** Set once the models are ready, so a scan can start drawing its far samples synchronously. */
let ready: FaceApi | null = null;

/** Models ship beside index.html (see scripts/copy-face-models.mjs), so nested hosting paths work. */
function modelBase(): string {
  return new URL('models/face-api/', window.location.href.split('#')[0]).href;
}

export function faceEngineSupported(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

export function loadFaceEngine(): Promise<FaceApi> {
  engine ??= (async () => {
    const faceapi = await import('@vladmandic/face-api');
    // The bundled TensorFlow.js has these at runtime; face-api's typings omit them.
    const tf = faceapi.tf as unknown as { setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
    const webgl = await tf.setBackend('webgl').catch(() => false);
    if (!webgl) await tf.setBackend('cpu');
    await tf.ready();
    const base = modelBase();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(base),
      faceapi.nets.faceLandmark68Net.loadFromUri(base),
      faceapi.nets.faceRecognitionNet.loadFromUri(base),
    ]);
    // The first WebGL run of each net compiles its shaders, which can take seconds on
    // phones. Do it once on a blank canvas so the first real frame is fast.
    if (webgl) await warmUp(faceapi).catch(() => {});
    ready = faceapi;
    return faceapi;
  })();
  // A failed download may be retried by reopening the camera.
  engine.catch(() => { engine = null; });
  return engine;
}

async function warmUp(faceapi: FaceApi): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 416; canvas.height = 416;
  await faceapi.detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }));
  await faceapi.nets.faceLandmark68Net.detectLandmarks(canvas);
  await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(canvas);
}

/** Start downloading and warming the models before any camera opens. Errors retry on open. */
export function preloadFaceEngine(): void {
  if (!faceEngineSupported()) return;
  void loadFaceEngine().catch(() => {});
}

/** `far` reads small, distant faces too (tiled pass); registration keeps the cheaper single pass. */
export async function detectFaces(video: HTMLVideoElement, options: { far?: boolean } = {}): Promise<DetectedFace[]> {
  return detectFacesWith(await loadFaceEngine(), video, options);
}

/**
 * This face as it would look from farther away, for saving with a scan. Starts
 * drawing immediately (the camera may close right after); resolves to nothing if the
 * models are not ready.
 */
export function farDescriptors(video: HTMLVideoElement, box: FaceBox, widths: number[], blurs: number[] = []): Promise<number[][]> {
  return ready ? farDescriptorsWith(ready, video, box, widths, blurs) : Promise.resolve([]);
}

/** A loosely framed JPEG of one face, used only as a preview attendee's portrait. */
export function cropFace(video: HTMLVideoElement, box: FaceBox, size = 320): string {
  const side = Math.min(Math.max(box.width, box.height) * 1.7, video.videoWidth, video.videoHeight);
  const left = Math.min(Math.max(box.x + box.width / 2 - side / 2, 0), video.videoWidth - side);
  const top = Math.min(Math.max(box.y + box.height / 2 - side / 2, 0), video.videoHeight - side);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  canvas.getContext('2d')?.drawImage(video, left, top, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.8);
}
