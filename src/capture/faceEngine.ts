import type { FaceBox } from '../face';
import { detectFacesWith, farDescriptorsWith, type DetectedFace, type FaceApi } from './faceDetect';

/**
 * Browser-only, on-device face detection and 128-number descriptors (face-api.js,
 * MIT). Frames never leave this tab; only descriptors of opted-in scans are saved.
 * Loaded lazily so the rest of the app never downloads TensorFlow or the models.
 *
 * The models run on TensorFlow.js's WebAssembly backend. WebGL was measured locking
 * the page for about 8 seconds in WebKit (the iPhone engine) while it compiled
 * shaders on the first frame; WebAssembly's first frame took 0.2 seconds at the same
 * steady speed, and both produce the same descriptors, so saved scans work with either.
 */
export type { DetectedFace };

let engine: Promise<FaceApi> | null = null;
/** Set once the models are ready, so a scan can start drawing its far samples synchronously. */
let ready: FaceApi | null = null;

/** Models ship beside index.html (see scripts/copy-face-models.mjs), so nested hosting paths work. */
function modelBase(): string {
  return new URL('models/face-api/', window.location.href.split('#')[0]).href;
}
/** The WebAssembly binaries are committed under public/tfjs-wasm (see SOURCE.txt there). */
function wasmBase(): string {
  return new URL('tfjs-wasm/', window.location.href.split('#')[0]).href;
}

export type FaceBackend = 'wasm' | 'webgl' | 'cpu';
let backend: FaceBackend | null = null;
/** Which engine the models ended up on; null until they are loaded. */
export const faceBackend = (): FaceBackend | null => backend;

export function faceEngineSupported(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

/** Hands the main thread back so taps and scrolling are handled between the heavy steps below. */
const breathe = () => new Promise<void>(resolve => setTimeout(resolve, 20));

export function loadFaceEngine(): Promise<FaceApi> {
  engine ??= (async () => {
    const faceapi = await import('@vladmandic/face-api');
    await breathe();
    // The bundled TensorFlow.js has these at runtime; face-api's typings omit them.
    const tf = faceapi.tf as unknown as {
      setBackend(name: string): Promise<boolean>; ready(): Promise<void>;
      setWasmPaths(prefix: string): void; env(): { set(flag: string, value: unknown): void };
    };
    let chosen: FaceBackend = 'cpu';
    try { tf.setWasmPaths(wasmBase()); } catch { /* falls through to WebGL below */ }
    if (await tf.setBackend('wasm').catch(() => false)) chosen = 'wasm';
    else {
      // Fallback only. Shape uniforms let shaders be reused across sizes, which cut the
      // measured first-frame stall from about 8 seconds to about 3.
      try { tf.env().set('WEBGL_USE_SHAPES_UNIFORMS', true); } catch { /* older builds */ }
      if (await tf.setBackend('webgl').catch(() => false)) chosen = 'webgl';
      else await tf.setBackend('cpu');
    }
    await tf.ready();
    await breathe();
    const base = modelBase();
    for (const load of [
      () => faceapi.nets.tinyFaceDetector.loadFromUri(base),
      () => faceapi.nets.faceLandmark68Net.loadFromUri(base),
      () => faceapi.nets.faceRecognitionNet.loadFromUri(base),
    ]) { await load(); await breathe(); }
    // The first run of each net is the slow one (on WebGL it compiles shaders). Do it
    // once on a blank canvas so the first real frame is fast.
    if (chosen !== 'cpu') await warmUp(faceapi).catch(() => {});
    backend = chosen;
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
  await breathe();
  await faceapi.nets.faceLandmark68Net.detectLandmarks(canvas);
  await breathe();
  await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(canvas);
  await breathe();
  // The far-sighted pass uses its own input sizes; on WebGL each size compiles separately.
  await detectFacesWith(faceapi, canvas, { far: true });
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
