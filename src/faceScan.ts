/**
 * Pure helpers for the guided face scan: where the head is pointing (from the 68
 * face landmarks), which part of the ring that fills, which samples to keep, and the
 * wireframe drawn over the face. No React, camera or model imports.
 */
import { faceDistance, SCAN_CONSISTENCY } from './face';
import { FACE_SCAN_SAMPLES } from './domain';

export type Point = readonly [number, number];
export interface HeadPose { yaw: number; pitch: number }

export const LANDMARK_COUNT = 68;
/** Ring segments, one per 45 degrees of head direction. Segment 0 points image-right, 2 points down. */
export const SCAN_BINS = 8;
/** A centred sample must be this close to straight-on. */
export const CENTER_YAW_LIMIT = 0.15;
/** How far the head must turn from its centred pose before a ring segment counts. */
export const TURN_THRESHOLD = 0.18;
/**
 * Nodding moves the nose tip less than turning does, so pitch is scaled up to compare.
 * 3 left a simulated straight up or down nod just under the threshold; 4.5 clears it.
 */
export const PITCH_SCALE = 4.5;
/**
 * An angled sample is kept only if it still looks like the centred face. This is the
 * match threshold: a looser limit would let a bad read widen who matches this person.
 */
export const ANGLE_SAMPLE_LIMIT = 0.5;

const mean = (points: readonly Point[], from: number, to: number, axis: 0 | 1) => {
  let sum = 0;
  for (let i = from; i <= to; i++) sum += points[i]![axis];
  return sum / (to - from + 1);
};

/**
 * Head direction from 2D landmarks. Yaw is where the nose tip sits between the two
 * sides of the jaw (0 straight on, positive toward image-right). Pitch is where it
 * sits between the eyes and the mouth (about 0.55 to 0.6 straight on, smaller looking
 * up). Both are compared with the person's own centred pose, never used as absolutes.
 */
export function headPose(points: readonly Point[] | undefined | null): HeadPose | null {
  if (!points || points.length !== LANDMARK_COUNT) return null;
  const nose = points[30]!, left = points[1]!, right = points[15]!;
  const span = right[0] - left[0];
  const eyes = mean(points, 36, 47, 1), mouth = mean(points, 48, 59, 1);
  const drop = mouth - eyes;
  if (!(span > 1) || !(drop > 1)) return null;
  const yaw = (2 * nose[0] - left[0] - right[0]) / span, pitch = (nose[1] - eyes) / drop;
  return Number.isFinite(yaw) && Number.isFinite(pitch) ? { yaw, pitch } : null;
}

/** Which ring segment the head points at relative to its centred pose, or null near the centre. */
export function turnBin(pose: HeadPose, base: HeadPose): number | null {
  const x = pose.yaw - base.yaw, y = (pose.pitch - base.pitch) * PITCH_SCALE;
  if (Math.hypot(x, y) < TURN_THRESHOLD) return null;
  return ((Math.round(Math.atan2(y, x) / (Math.PI / 4)) % SCAN_BINS) + SCAN_BINS) % SCAN_BINS;
}

/** On a mirrored preview a segment appears on the opposite side. */
export const mirrorBin = (bin: number): number => (SCAN_BINS / 2 - bin + SCAN_BINS) % SCAN_BINS;

/**
 * One guided scan. First a few straight-on samples that must agree with each other,
 * then one sample per ring segment as the head moves around. Every segment the head
 * reaches is marked, but its sample is kept only if it still resembles the centred face.
 */
export class ScanCoverage {
  private center: { descriptor: number[]; pose: HeadPose }[] = [];
  private base: HeadPose | null = null;
  private visited: boolean[] = Array.from({ length: SCAN_BINS }, () => false);
  private angles: (number[] | null)[] = Array.from({ length: SCAN_BINS }, () => null);

  get centerCount(): number { return this.center.length; }
  get centerDone(): boolean { return this.base !== null; }
  get filled(): boolean[] { return [...this.visited]; }
  get filledCount(): number { return this.visited.filter(Boolean).length; }
  get complete(): boolean { return this.centerDone && this.visited.every(Boolean); }
  centerDescriptors(): number[][] { return this.center.map(sample => sample.descriptor); }
  angleDescriptors(): number[][] { return this.angles.filter((sample): sample is number[] => sample !== null); }

  /**
   * Adds a straight-on sample. 'more' while collecting, 'done' once enough agree,
   * 'restart' when they did not look like one person (the collection starts over),
   * 'turned' when the head was not straight on and nothing was added.
   */
  addCenter(descriptor: number[], pose: HeadPose): 'more' | 'done' | 'restart' | 'turned' {
    if (this.centerDone) return 'done';
    if (Math.abs(pose.yaw) > CENTER_YAW_LIMIT) return 'turned';
    this.center.push({ descriptor, pose });
    if (this.center.length < FACE_SCAN_SAMPLES) return 'more';
    const samples = this.centerDescriptors();
    const agree = samples.every((a, i) => samples.slice(i + 1).every(b => faceDistance(a, b) < SCAN_CONSISTENCY));
    if (!agree) { this.center = []; return 'restart'; }
    this.base = {
      yaw: this.center.reduce((sum, sample) => sum + sample.pose.yaw, 0) / this.center.length,
      pitch: this.center.reduce((sum, sample) => sum + sample.pose.pitch, 0) / this.center.length,
    };
    return 'done';
  }

  /** After the centre is done: marks the segment the head points at. Returns it, or null near the centre. */
  offer(descriptor: number[] | undefined, pose: HeadPose): { bin: number | null; added: boolean } {
    if (!this.base) return { bin: null, added: false };
    const bin = turnBin(pose, this.base);
    if (bin === null || this.visited[bin]) return { bin, added: false };
    this.visited[bin] = true;
    if (descriptor && this.center.some(sample => faceDistance(descriptor, sample.descriptor) < ANGLE_SAMPLE_LIMIT)) {
      this.angles[bin] = descriptor;
    }
    return { bin, added: true };
  }
}

/** The face to scan: the largest one, unless a second face is nearly as large. */
export function primaryFace<T extends { box: { width: number } }>(faces: readonly T[]): T | null {
  if (!faces.length) return null;
  const sorted = [...faces].sort((a, b) => b.box.width - a.box.width);
  const [first, second] = sorted;
  return second && second.box.width >= first!.box.width * 0.6 ? null : first!;
}

/**
 * Wireframe over the 68 landmarks, as pairs of landmark indices. Generated once by
 * triangulating a straight-on face and dropping the long chords across the jawline,
 * so the same lines are drawn every frame and the mesh never flickers.
 */
export const MESH_EDGES: readonly (readonly [number, number])[] = [
  [0,1], [0,17], [0,36], [1,2], [1,36], [1,41], [2,3], [2,31], [2,41], [2,48], [3,4], [3,48], [4,5], [4,48],
  [5,6], [5,48], [5,59], [5,60], [6,7], [6,58], [6,59], [7,8], [7,57], [7,58], [8,9], [8,57], [9,10], [9,56],
  [9,57], [10,11], [10,55], [10,56], [11,12], [11,54], [11,55], [12,13], [12,54], [13,14], [13,54], [14,15],
  [14,46], [14,54], [15,16], [15,45], [15,46], [16,26], [16,45], [17,18], [17,36], [18,19], [18,36], [18,37],
  [19,20], [19,37], [20,21], [20,22], [20,23], [20,37], [20,38], [21,22], [21,27], [21,38], [21,39], [22,23],
  [22,27], [22,42], [22,43], [23,24], [23,43], [23,44], [24,25], [24,44], [25,26], [25,44], [25,45], [26,45],
  [27,28], [27,39], [27,42], [28,29], [28,39], [28,40], [28,42], [29,30], [29,31], [29,35], [29,40], [29,42],
  [29,47], [30,31], [30,32], [30,33], [30,34], [30,35], [31,32], [31,40], [31,41], [31,48], [31,49], [31,50],
  [32,33], [32,50], [33,34], [33,50], [33,51], [33,52], [34,35], [34,52], [35,46], [35,47], [35,52], [35,53],
  [35,54], [35,64], [36,37], [36,41], [37,38], [37,41], [38,39], [38,40], [38,41], [39,40], [40,41], [42,43],
  [42,47], [43,44], [43,46], [43,47], [44,45], [44,46], [45,46], [46,47], [46,54], [48,49], [48,60], [49,50],
  [49,59], [49,60], [49,61], [50,51], [50,61], [50,62], [51,52], [51,62], [52,53], [52,62], [52,63], [53,55],
  [53,63], [53,64], [53,65], [54,55], [54,64], [55,56], [55,64], [55,65], [56,57], [56,65], [56,66], [57,58],
  [57,66], [58,59], [58,66], [58,67], [59,60], [59,61], [59,67], [61,62], [61,67], [62,63], [62,65], [62,66],
  [62,67], [63,65], [65,66], [66,67],
];
