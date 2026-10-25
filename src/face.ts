import { FACE_DESCRIPTOR_LENGTH, FACE_SCAN_SAMPLES, type FaceTemplate } from './domain';

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
export const MIN_SCAN_FACE_WIDTH = 110;

export function validDescriptors(descriptors: unknown): descriptors is number[][] {
  return Array.isArray(descriptors) && descriptors.length >= 1 && descriptors.length <= FACE_SCAN_SAMPLES
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
export function matchDescriptor(descriptor: ArrayLike<number>, templates: FaceTemplate[]): FaceMatch | null {
  const ranked = templates
    .map(t => ({ profileId: t.profileId, distance: Math.min(...t.descriptors.map(d => faceDistance(descriptor, d))) }))
    .sort((a, b) => a.distance - b.distance);
  const [best, second] = ranked;
  if (!best || best.distance >= MATCH_THRESHOLD) return null;
  if (second && second.distance - best.distance < MATCH_MARGIN) return null;
  return best;
}

/** True when every sample pair is plausibly the same face. */
export function consistentSamples(samples: number[][]): boolean {
  return samples.every((a, i) => samples.slice(i + 1).every(b => faceDistance(a, b) < SCAN_CONSISTENCY));
}

/** Why this frame can't be used for a face scan, or null when it can. */
export function scanProblem(faces: { box: FaceBox; score: number }[]): string | null {
  if (!faces.length) return 'Look at the camera. No face found yet.';
  if (faces.length > 1) return 'Only the person being scanned should be in frame.';
  if (faces[0].box.width < MIN_SCAN_FACE_WIDTH) return 'Move a little closer.';
  // The tiny detector often scores clear frontal faces at 0.6–0.7; sample consistency is the real guard.
  if (faces[0].score < 0.6) return 'Face the camera in good light.';
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

/** Map a box in source video pixels onto an object-fit: cover view, optionally mirrored. */
export function projectBox(box: FaceBox, video: { width: number; height: number },
  view: { width: number; height: number }, mirrored: boolean): FaceBox {
  const scale = Math.max(view.width / video.width, view.height / video.height);
  const offsetX = (view.width - video.width * scale) / 2;
  const offsetY = (view.height - video.height * scale) / 2;
  const width = box.width * scale, height = box.height * scale;
  const left = offsetX + box.x * scale;
  return { x: mirrored ? view.width - left - width : left, y: offsetY + box.y * scale, width, height };
}
