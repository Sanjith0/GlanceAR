import { compactDescriptor, MIN_FACE_WIDTH, MIN_FAR_FACE_WIDTH, type FaceBox } from '../face';

/**
 * Face detection that works at a distance. Browser-only; the face-api instance is
 * passed in so the same code runs in the app and in a test page.
 *
 * Why it is more than one detector call: the tiny detector squeezes the whole frame
 * into one square, so on a tall glasses frame (504×896) a face 50 px wide shrinks to
 * under 25 px and is lost. Here a far-sighted pass splits the frame into two
 * overlapping squares along its long side, so faces keep their size, then re-reads
 * each small face from an upscaled crop. Measured on sample portraits shrunk onto a
 * glasses-sized frame, faces were found down to about 36 px wide (the old pass lost
 * them below 64 px).
 */
export type DetectedFace = {
  box: FaceBox; score: number; descriptor?: number[];
  /** The 68 face landmarks in source pixels. Only from the close-up (non-far) pass, for the guided scan. */
  landmarks?: [number, number][];
};
export type FaceApi = typeof import('@vladmandic/face-api');
type Source = HTMLVideoElement | HTMLCanvasElement;

const TILE_INPUT = 512;
const TILE_SCORE = 0.4;
const CROP_SIZE = 256;
const CROP_MARGIN = 0.55;

/**
 * Hands the main thread back between stages. On the WebAssembly backend each model
 * call runs to completion without yielding, so without these a whole frame would hold
 * the page for 100 ms or more at a time and taps would feel sticky.
 */
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const tiny = (faceapi: FaceApi, inputSize: number, scoreThreshold: number) =>
  new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold });

function sizeOf(source: Source): { width: number; height: number } {
  return typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement
    ? { width: source.videoWidth, height: source.videoHeight } : { width: source.width, height: source.height };
}

function canvas(width: number, height = width): HTMLCanvasElement {
  const element = document.createElement('canvas');
  element.width = Math.max(1, Math.round(width)); element.height = Math.max(1, Math.round(height));
  return element;
}

const overlap = (a: FaceBox, b: FaceBox) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a.width * a.height + b.width * b.height - inter);
};

/** Keeps the highest-scoring box of any overlapping group. */
export function dedupe<T extends { box: FaceBox; score: number }>(found: T[]): T[] {
  const kept: T[] = [];
  for (const candidate of [...found].sort((a, b) => b.score - a.score)) {
    if (!kept.some(other => overlap(other.box, candidate.box) > 0.3)) kept.push(candidate);
  }
  return kept;
}

/** Where to cut the frame into squares: one for a squarish frame, two overlapping for a long one. */
export function tileOrigins(width: number, height: number): { x: number; y: number; side: number }[] {
  const side = Math.min(width, height);
  if (Math.max(width, height) <= side * 1.2) return [{ x: 0, y: 0, side }];
  return width > height
    ? [{ x: 0, y: 0, side }, { x: width - side, y: 0, side }]
    : [{ x: 0, y: 0, side }, { x: 0, y: height - side, side }];
}

async function findBoxes(faceapi: FaceApi, source: Source): Promise<{ box: FaceBox; score: number }[]> {
  const { width, height } = sizeOf(source);
  const found: { box: FaceBox; score: number }[] = [];
  for (const tile of tileOrigins(width, height)) {
    const piece = canvas(tile.side);
    piece.getContext('2d')?.drawImage(source, tile.x, tile.y, tile.side, tile.side, 0, 0, tile.side, tile.side);
    for (const detection of await faceapi.detectAllFaces(piece, tiny(faceapi, TILE_INPUT, TILE_SCORE))) {
      const { x, y, width: w, height: h } = detection.box;
      found.push({ box: { x: x + tile.x, y: y + tile.y, width: w, height: h }, score: detection.score });
    }
    await pause();
  }
  return dedupe(found);
}

/** A square crop around the face, scaled up to CROP_SIZE so the nets get something to read. */
function faceCrop(source: Source, box: FaceBox): HTMLCanvasElement {
  const side = Math.max(box.width, box.height) * (1 + CROP_MARGIN * 2);
  const piece = canvas(CROP_SIZE);
  const context = piece.getContext('2d');
  if (context) {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#808080';
    context.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
    context.drawImage(source, box.x + box.width / 2 - side / 2, box.y + box.height / 2 - side / 2, side, side, 0, 0, CROP_SIZE, CROP_SIZE);
  }
  return piece;
}

async function describeCrop(faceapi: FaceApi, piece: HTMLCanvasElement): Promise<number[] | undefined> {
  const result = await faceapi.detectSingleFace(piece, tiny(faceapi, CROP_SIZE, 0.25)).withFaceLandmarks().withFaceDescriptor();
  return result ? compactDescriptor(result.descriptor) : undefined;
}

/**
 * Faces in a frame, each with a descriptor when it is big enough to read. With `far`,
 * uses the tiled pass and reads faces down to MIN_FAR_FACE_WIDTH; otherwise the
 * original single pass (cheaper; fine for registration, where faces are close).
 */
export async function detectFacesWith(faceapi: FaceApi, source: Source, options: { far?: boolean } = {}): Promise<DetectedFace[]> {
  if (!options.far) {
    const results = await faceapi
      .detectAllFaces(source, tiny(faceapi, 416, 0.5))
      .withFaceLandmarks()
      .withFaceDescriptors();
    return results.map(result => {
      const { x, y, width, height } = result.detection.box;
      return {
        box: { x, y, width, height }, score: result.detection.score,
        landmarks: result.landmarks.positions.map((point): [number, number] =>
          [Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10]),
        // Too-small faces produce unreliable descriptors; they are shown but never matched.
        ...(width >= MIN_FACE_WIDTH ? { descriptor: compactDescriptor(result.descriptor) } : {}),
      };
    });
  }
  // One still copy of the frame: the stages below yield to the page between them, and a
  // live video would otherwise move on, leaving boxes from one moment on a later picture.
  const { width, height } = sizeOf(source);
  const still = canvas(width, height);
  still.getContext('2d')?.drawImage(source, 0, 0, width, height);
  const out: DetectedFace[] = [];
  for (const { box, score } of await findBoxes(faceapi, still)) {
    const face: DetectedFace = { box, score };
    if (box.width >= MIN_FAR_FACE_WIDTH) {
      const piece = faceCrop(still, box);
      const descriptor = await describeCrop(faceapi, piece).catch(() => undefined);
      if (descriptor) face.descriptor = descriptor;
      await pause();
    }
    out.push(face);
  }
  return out;
}

/**
 * Descriptors of this face as it would look from farther away. The face and its
 * surroundings are shrunk to each width in turn and read back through the same path
 * as a distant face in the live feed, so the saved scan covers both close and far
 * appearances. Drawing happens now, synchronously, so the camera may close right after.
 */
export function farDescriptorsWith(faceapi: FaceApi, source: Source, box: FaceBox, widths: number[], blurs: number[] = []): Promise<number[][]> {
  const frames = widths.map((width, index) => {
    const scale = width / box.width;
    const side = box.width * 3.2;
    const size = 320;
    const piece = canvas(size);
    const context = piece.getContext('2d');
    if (context) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.fillStyle = '#808080';
      context.fillRect(0, 0, size, size);
      const drawn = side * scale;
      // A little blur on the farthest samples: distant faces in a moving camera are soft, not sharp.
      if (blurs[index]) context.filter = `blur(${blurs[index]}px)`;
      context.drawImage(source, box.x + box.width / 2 - side / 2, box.y + box.height / 2 - side / 2, side, side,
        (size - drawn) / 2, (size - drawn) / 2, drawn, drawn);
    }
    return piece;
  });
  return (async () => {
    const out: number[][] = [];
    for (const piece of frames) {
      try {
        const found = await faceapi.detectSingleFace(piece, tiny(faceapi, 320, 0.25)).withFaceLandmarks().withFaceDescriptor();
        if (found) out.push(compactDescriptor(found.descriptor));
      } catch { /* one unreadable shrink is skipped */ }
    }
    return out;
  })();
}
