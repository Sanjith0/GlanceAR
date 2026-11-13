import { FACE_DESCRIPTOR_LENGTH, FACE_MAX_DESCRIPTORS, type FaceTemplate } from './domain';

/** Pure face utilities shared by the browser camera and the Convex backend. No frames, only numbers. */
export type FaceBox = { x: number; y: number; width: number; height: number };
export type FaceMatch = { profileId: string; distance: number };

/** Euclidean distance; face-api's own guidance treats < 0.6 as the same person. Stricter here. */
export const MATCH_THRESHOLD = 0.5;
/** The best person must beat the runner-up by this much, or the face is ambiguous. */
export const MATCH_MARGIN = 0.06;
/** Scan samples farther apart than this probably show different people or a bad frame. */
export const SCAN_CONSISTENCY = 0.42;
/** Faces narrower than this (source pixels) give unreliable descriptors. */
export const MIN_FACE_WIDTH = 64;
/** The far-sighted pass reads faces down to this width (source pixels). */
export const MIN_FAR_FACE_WIDTH = 36;
/** Below this width a descriptor is noisier, so a match must clear a wider margin. */
export const SMALL_FACE_WIDTH = 64;
export const SMALL_FACE_MARGIN = 0.1;
/** Smallest face a scan accepts when the frame size is unknown. */
export const MIN_SCAN_FACE_WIDTH = 80;
/** With a known frame, a scan needs the face to span this share of its shorter side (never under 72 px). */
export const MIN_SCAN_FACE_SHARE = 0.12;

export function validDescriptors(descriptors: unknown): descriptors is number[][] {
  return Array.isArray(descriptors) && descriptors.length >= 1 && descriptors.length <= FACE_MAX_DESCRIPTORS
    && descriptors.every(d => Array.isArray(d) && d.length === FACE_DESCRIPTOR_LENGTH
      && d.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1));
}

/** Four decimals keeps matching unchanged and halves the synced payload. */
export function compactDescriptor(descriptor: ArrayLike<number>): number[] {
  return Array.from(descriptor, x => Math.round(x * 10_000) / 10_000);
}

export function faceDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d; }
  return Math.sqrt(sum);
}

/** Closest enrolled person, or null when nobody is close enough or two people are too alike. */
export function matchDescriptor(descriptor: ArrayLike<number>, templates: FaceTemplate[], faceWidth?: number): FaceMatch | null {
  const ranked = templates
    .map(t => ({ profileId: t.profileId, distance: Math.min(...t.descriptors.map(d => faceDistance(descriptor, d))) }))
    .sort((a, b) => a.distance - b.distance);
  const [best, second] = ranked;
  if (!best || best.distance >= MATCH_THRESHOLD) return null;
  const margin = faceWidth !== undefined && faceWidth < SMALL_FACE_WIDTH ? SMALL_FACE_MARGIN : MATCH_MARGIN;
  if (second && second.distance - best.distance < margin) return null;
  return best;
}

/** Far samples are kept only if they still look like the close-up scan; anything else is a bad read. */
export const FAR_SAMPLE_LIMIT = 0.6;
export function keepFarSamples(near: number[][], far: number[][]): number[][] {
  return far.filter(sample => near.some(d => faceDistance(sample, d) < FAR_SAMPLE_LIMIT));
}

/** True when every sample pair is plausibly the same face. */
export function consistentSamples(samples: number[][]): boolean {
  return samples.every((a, i) => samples.slice(i + 1).every(b => faceDistance(a, b) < SCAN_CONSISTENCY));
}

/** Why this frame can't be used for a face scan, or null when it can. */
export function scanProblem(
  faces: { box: FaceBox; score: number }[], frame?: { width: number; height: number }, turning = false,
): string | null {
  if (!faces.length) return 'Look at the camera. No face found yet.';
  // People well behind the person being scanned are ignored; two faces of similar size are not.
  const [main, other] = [...faces].sort((a, b) => b.box.width - a.box.width);
  if (other && other.box.width >= main!.box.width * 0.6) return 'Only the person being scanned should be in frame.';
  const needed = frame ? Math.max(72, Math.min(frame.width, frame.height) * MIN_SCAN_FACE_SHARE) : MIN_SCAN_FACE_WIDTH;
  if (main!.box.width < needed) return 'Move a little closer.';
  // The tiny detector often scores clear frontal faces at 0.6–0.7; sample consistency is the real guard.
  // A turned head scores lower by nature, so the turning phase does not ask for it.
  if (!turning && main!.score < 0.6) return 'Face the camera in good light.';
  return null;
}

/**
 * Debounces recognition: a person counts as present only after several hits over
 * a short span, and is forgotten after a gap. One stray frame never pairs anyone.
 */
export class RecognitionTracker {
  private seen = new Map<string, { first: number; last: number; hits: number }>();
  constructor(private minHits = 3, private minSpanMs = 600, private gapMs = 1_200) {}
  observe(profileIds: string[], now: number): string[] {
    for (const [id, entry] of this.seen) if (now - entry.last > this.gapMs) this.seen.delete(id);
    for (const id of new Set(profileIds)) {
      const entry = this.seen.get(id);
      if (entry) { entry.hits++; entry.last = now; } else this.seen.set(id, { first: now, last: now, hits: 1 });
    }
    return [...this.seen].filter(([id, e]) => profileIds.includes(id) && e.hits >= this.minHits
      && now - e.first >= this.minSpanMs).map(([id]) => id);
  }
  reset() { this.seen.clear(); }
}

/**
 * Map a box in source video pixels onto the view that shows the video, optionally
 * mirrored. 'cover' fills the view and crops the picture; 'contain' shows all of it
 * with bars at the sides. Must match the video element's object-fit.
 */
export function projectBox(box: FaceBox, video: { width: number; height: number },
  view: { width: number; height: number }, mirrored: boolean, fit: 'cover' | 'contain' = 'cover'): FaceBox {
  const ratios = [view.width / video.width, view.height / video.height] as const;
  const scale = fit === 'contain' ? Math.min(...ratios) : Math.max(...ratios);
  const offsetX = (view.width - video.width * scale) / 2;
  const offsetY = (view.height - video.height * scale) / 2;
  const width = box.width * scale, height = box.height * scale;
  const left = offsetX + box.x * scale;
  return { x: mirrored ? view.width - left - width : left, y: offsetY + box.y * scale, width, height };
}
