import { compactDescriptor, MIN_FACE_WIDTH, type FaceBox } from '../face';
import { glassesCameraActive } from './glassesBridge';

/**
 * Browser-only, on-device face detection and 128-number descriptors (face-api.js,
 * MIT). Frames never leave this tab; only descriptors of opted-in scans are saved.
 * Loaded lazily so the rest of the app never downloads TensorFlow or the models.
 */
export type DetectedFace = { box: FaceBox; score: number; descriptor?: number[] };
type FaceApi = typeof import('@vladmandic/face-api');

let engine: Promise<FaceApi> | null = null;

/** Models ship beside index.html (see scripts/copy-face-models.mjs), so nested hosting paths work. */
function modelBase(): string {
  return new URL('models/face-api/', window.location.href.split('#')[0]).href;
}

export function faceEngineSupported(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia) && (window.isSecureContext || glassesCameraActive());
}

export function loadFaceEngine(): Promise<FaceApi> {
  engine ??= (async () => {
    const faceapi = await import('@vladmandic/face-api');
    // The bundled TensorFlow.js has these at runtime; face-api's typings omit them.
    const tf = faceapi.tf as unknown as { setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
    if (!await tf.setBackend('webgl').catch(() => false)) await tf.setBackend('cpu');
    await tf.ready();
    const base = modelBase();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(base),
      faceapi.nets.faceLandmark68Net.loadFromUri(base),
      faceapi.nets.faceRecognitionNet.loadFromUri(base),
    ]);
    return faceapi;
  })();
  // A failed download may be retried by reopening the camera.
  engine.catch(() => { engine = null; });
  return engine;
}

export async function detectFaces(video: HTMLVideoElement): Promise<DetectedFace[]> {
  const faceapi = await loadFaceEngine();
  const results = await faceapi
    .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  return results.map(result => {
    const { x, y, width, height } = result.detection.box;
    return {
      box: { x, y, width, height }, score: result.detection.score,
      // Too-small faces produce unreliable descriptors; they are shown but never matched.
      ...(width >= MIN_FACE_WIDTH ? { descriptor: compactDescriptor(result.descriptor) } : {}),
    };
  });
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
