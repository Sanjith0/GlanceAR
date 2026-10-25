/** Anonymous geometry only. No identity, face association, image storage or network calls. */
export type HandPoint = { x: number; y: number; z: number };
export type HandSample = { landmarks: HandPoint[]; worldLandmarks?: HandPoint[] };
export type HandAssessment = {
  valid: boolean;
  complete: boolean;
  fingers: [boolean, boolean, boolean, boolean, boolean];
  center: HandPoint;
  scale: number;
};
const subtract = (a: HandPoint, b: HandPoint): HandPoint => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: HandPoint, b: HandPoint) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: HandPoint) => Math.hypot(a.x, a.y, a.z);
const distance = (a: HandPoint, b: HandPoint) => length(subtract(a, b));
const finite = (p: HandPoint) => p && [p.x, p.y, p.z].every(Number.isFinite);
const angle = (a: HandPoint, b: HandPoint, c: HandPoint) => {
  const ab = subtract(a, b), cb = subtract(c, b), denominator = length(ab) * length(cb);
  return denominator < 1e-12 ? 0 : Math.acos(Math.max(-1, Math.min(1, dot(ab, cb) / denominator))) * 180 / Math.PI;
};
const empty = (): HandAssessment => ({
  valid: false, complete: false, fingers: [false, false, false, false, false],
  center: { x: 0, y: 0, z: 0 }, scale: 0,
});

/**
 * Thumb + index + middle extended; ring + little actually curled, not merely lowered.
 * Angles, distances and palm-local dot products are invariant to mirroring/rotation.
 * World coordinates avoid image aspect-ratio distortion; corrected image coordinates
 * are a fallback, not an identity or handedness classifier.
 */
export function assessHand(sample: HandSample, aspectRatio = 1): HandAssessment {
  const image = sample.landmarks;
  if (image.length !== 21 || !image.every(finite) || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return empty();
  const metricImage = image.map(p => ({ x: p.x * aspectRatio, y: p.y, z: p.z * aspectRatio }));
  const points = sample.worldLandmarks ?? metricImage;
  if (points.length !== 21 || !points.every(finite)) return empty();
  const palm = distance(points[0], points[9]), width = distance(points[5], points[17]);
  const scale = distance(metricImage[0], metricImage[9]);
  const center = { x: (metricImage[0].x + metricImage[9].x) / 2,
    y: (metricImage[0].y + metricImage[9].y) / 2, z: 0 };
  // Do not complete from clipped, tiny, missing or degenerate landmark sets.
  const complete = image.every(p => p.x > 0.015 && p.x < 0.985 && p.y > 0.015 && p.y < 0.985)
    && scale > 0.045 && palm > 1e-5 && width > palm * 0.3 && width < palm * 2.2;
  if (!complete) return { ...empty(), center, scale };
  const straight = (base: number) => {
    const [mcp, pip, dip, tip] = points.slice(base, base + 4);
    const path = distance(mcp, pip) + distance(pip, dip) + distance(dip, tip);
    // Predicted world depth is noisier than the image-plane joint locations.
    // Require 90% straight-line reach as well as joint limits, not brittle 2D
    // angle cutoffs applied to 3D estimates (which reject naturally straight hands).
    return angle(mcp, pip, dip) > 140 && angle(pip, dip, tip) > 130 && distance(tip, mcp) > path * 0.9
      && distance(tip, points[0]) > distance(pip, points[0]) + palm * 0.2
      && distance(tip, mcp) > palm * 0.65;
  };
  const curled = (base: number) => {
    const [mcp, pip, dip, tip] = points.slice(base, base + 4);
    const path = distance(mcp, pip) + distance(pip, dip) + distance(dip, tip);
    return (angle(mcp, pip, dip) < 135 || angle(pip, dip, tip) < 135)
      && distance(tip, mcp) < path * 0.85
      && distance(tip, points[0]) < distance(pip, points[0]) + palm * 0.12;
  };
  const thumb = angle(points[1], points[2], points[3]) > 140
    && angle(points[2], points[3], points[4]) > 150
    && distance(points[4], points[1]) > palm * 0.75
    && distance(points[4], points[5]) > width * 0.55
    && distance(points[4], points[0]) > distance(points[3], points[0]) + palm * 0.1
    // A straight thumb laid across the palm is still folded, not extended outward.
    && dot(subtract(points[4], points[5]), subtract(points[5], points[17])) > width * width * 0.12;
  const fingers: HandAssessment['fingers'] = [thumb, straight(5), straight(9), straight(13), straight(17)];
  return { valid: thumb && fingers[1] && fingers[2] && curled(13) && curled(17), complete, fingers, center, scale };
}

export type HandGateResult = { hands: number; stable: boolean; progress: number };
export const HAND_HOLD_MS = 650;
export const HAND_MIN_FRAMES = 6;
export const HAND_MAX_GAP_MS = 300;

/** A one-shot, continuous two-hand gate. A new active session must reset it. */
export class TwoHandGate {
  private startedAt: number | null = null;
  private lastAt: number | null = null;
  private frames = 0;
  private previous: HandAssessment[] = [];
  private fired = false;

  reset() {
    this.startedAt = null; this.lastAt = null; this.frames = 0; this.previous = []; this.fired = false;
  }
  private clearHold() {
    this.startedAt = null; this.frames = 0; this.previous = [];
  }
  observe(hands: HandAssessment[], timestamp: number): HandGateResult {
    const count = hands.filter(hand => hand.valid).length;
    const result = { hands: count, stable: false, progress: 0 };
    if (this.fired) return result;
    if (!Number.isFinite(timestamp) || (this.lastAt !== null && timestamp <= this.lastAt)) {
      this.clearHold(); return result;
    }
    if (this.lastAt !== null && timestamp - this.lastAt > HAND_MAX_GAP_MS) this.clearHold();
    this.lastAt = timestamp;
    if (hands.length !== 2 || count !== 2
      || distance(hands[0].center, hands[1].center) < (hands[0].scale + hands[1].scale) * 0.35) {
      this.clearHold(); return result;
    }
    if (this.previous.length) {
      const matches = (a: HandAssessment, b: HandAssessment) =>
        distance(a.center, b.center) < Math.max(a.scale, b.scale) * 0.75
        && Math.max(a.scale, b.scale) / Math.min(a.scale, b.scale) < 1.65;
      // Model result order can change between frames; neither handedness nor index is an identity.
      const continuous = matches(hands[0], this.previous[0]) && matches(hands[1], this.previous[1])
        || matches(hands[0], this.previous[1]) && matches(hands[1], this.previous[0]);
      if (!continuous) this.clearHold();
    }
    this.startedAt ??= timestamp;
    this.previous = hands;
    this.frames++;
    const elapsed = timestamp - this.startedAt;
    result.progress = Math.min(1, elapsed / HAND_HOLD_MS, this.frames / HAND_MIN_FRAMES);
    if (elapsed >= HAND_HOLD_MS && this.frames >= HAND_MIN_FRAMES) {
      this.fired = true; result.stable = true;
    }
    return result;
  }
}
