import { describe, expect, it } from 'vitest';
import { FACE_MAX_DESCRIPTORS, FACE_SCAN_SAMPLES } from '../src/domain';
import { scanProblem } from '../src/face';
import {
  ANGLE_SAMPLE_LIMIT, CENTER_YAW_LIMIT, LANDMARK_COUNT, MESH_EDGES, PITCH_SCALE, SCAN_BINS, ScanCoverage, TURN_THRESHOLD,
  headPose, mirrorBin, primaryFace, turnBin, type Point,
} from '../src/faceScan';

/** 68 landmarks with only the points the pose reads set: jaw sides, nose tip, eyes and mouth. */
function landmarks(noseX: number, noseY: number): Point[] {
  const points: [number, number][] = Array.from({ length: LANDMARK_COUNT }, () => [100, 100]);
  points[1] = [50, 100]; points[15] = [150, 100];
  for (let i = 36; i <= 47; i++) points[i] = [100, 80];
  for (let i = 48; i <= 59; i++) points[i] = [100, 130];
  points[30] = [noseX, noseY];
  return points;
}
const vec = (value: number) => Array.from({ length: 128 }, (_, i) => (i === 0 ? value : 0));
const straight = { yaw: 0, pitch: 0.56 };

describe('head pose from landmarks', () => {
  it('reads straight on as no yaw and a mid pitch', () => {
    expect(headPose(landmarks(100, 108))).toEqual({ yaw: 0, pitch: 0.56 });
  });

  it('reads the nose moving sideways as yaw and up or down as pitch', () => {
    expect(headPose(landmarks(115, 108))!.yaw).toBeCloseTo(0.3);
    expect(headPose(landmarks(85, 108))!.yaw).toBeCloseTo(-0.3);
    expect(headPose(landmarks(100, 100))!.pitch).toBeLessThan(0.56);
    expect(headPose(landmarks(100, 118))!.pitch).toBeGreaterThan(0.56);
  });

  it('returns nothing for missing or collapsed landmarks', () => {
    expect(headPose(null)).toBeNull();
    expect(headPose([[1, 1]])).toBeNull();
    const flat = landmarks(100, 108); flat[15] = [50, 100];
    expect(headPose(flat)).toBeNull();
  });
});

describe('ring segments', () => {
  it('stays empty near the centre', () => {
    expect(turnBin({ yaw: TURN_THRESHOLD / 2, pitch: 0.56 }, straight)).toBeNull();
  });

  it('maps the eight head directions to eight different segments', () => {
    const d = TURN_THRESHOLD * 1.5, p = d / PITCH_SCALE;
    const bins = [
      turnBin({ yaw: d, pitch: 0.56 }, straight), turnBin({ yaw: d, pitch: 0.56 + p }, straight),
      turnBin({ yaw: 0, pitch: 0.56 + p }, straight), turnBin({ yaw: -d, pitch: 0.56 + p }, straight),
      turnBin({ yaw: -d, pitch: 0.56 }, straight), turnBin({ yaw: -d, pitch: 0.56 - p }, straight),
      turnBin({ yaw: 0, pitch: 0.56 - p }, straight), turnBin({ yaw: d, pitch: 0.56 - p }, straight),
    ];
    expect(bins).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('measures from the person’s own centred pose', () => {
    expect(turnBin({ yaw: 0.2, pitch: 0.6 }, { yaw: 0.19, pitch: 0.6 })).toBeNull();
  });

  it('flips sideways on a mirrored preview and keeps up and down', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(mirrorBin)).toEqual([4, 3, 2, 1, 0, 7, 6, 5]);
  });
});

describe('guided scan coverage', () => {
  const centred = (coverage: ScanCoverage) => { for (let i = 0; i < FACE_SCAN_SAMPLES; i++) coverage.addCenter(vec(0.1 + i * 0.01), straight); };

  it('needs straight-on samples that agree before the ring starts', () => {
    const coverage = new ScanCoverage();
    expect(coverage.addCenter(vec(0.1), { yaw: CENTER_YAW_LIMIT + 0.05, pitch: 0.56 })).toBe('turned');
    expect(coverage.centerCount).toBe(0);
    expect(coverage.addCenter(vec(0.1), straight)).toBe('more');
    expect(coverage.addCenter(vec(0.11), straight)).toBe('more');
    expect(coverage.offer(vec(0.1), { yaw: 0.4, pitch: 0.56 })).toEqual({ bin: null, added: false });
    expect(coverage.addCenter(vec(0.12), straight)).toBe('done');
    expect(coverage.centerDone).toBe(true);
    expect(coverage.centerDescriptors()).toHaveLength(FACE_SCAN_SAMPLES);
  });

  it('starts the straight-on step over when the samples look like different people', () => {
    const coverage = new ScanCoverage();
    coverage.addCenter(vec(0.1), straight);
    coverage.addCenter(vec(0.9), straight);
    expect(coverage.addCenter(vec(0.1), straight)).toBe('restart');
    expect(coverage.centerCount).toBe(0);
    expect(coverage.centerDone).toBe(false);
  });

  it('fills each segment once and keeps its sample', () => {
    const coverage = new ScanCoverage();
    centred(coverage);
    expect(coverage.offer(vec(0.3), { yaw: 0.3, pitch: 0.56 })).toEqual({ bin: 0, added: true });
    expect(coverage.offer(vec(0.35), { yaw: 0.3, pitch: 0.56 })).toEqual({ bin: 0, added: false });
    expect(coverage.offer(vec(0.2), { yaw: 0.02, pitch: 0.56 })).toEqual({ bin: null, added: false });
    expect(coverage.filledCount).toBe(1);
    expect(coverage.angleDescriptors()).toEqual([vec(0.3)]);
  });

  it('marks a segment but drops a sample that no longer looks like the centred face', () => {
    const coverage = new ScanCoverage();
    centred(coverage);
    expect(coverage.offer(vec(0.12 + ANGLE_SAMPLE_LIMIT + 0.1), { yaw: -0.3, pitch: 0.56 })).toEqual({ bin: 4, added: true });
    expect(coverage.offer(undefined, { yaw: 0, pitch: 0.56 + 0.1 })).toEqual({ bin: 2, added: true });
    expect(coverage.filledCount).toBe(2);
    expect(coverage.angleDescriptors()).toEqual([]);
  });

  it('is complete after all eight segments and never exceeds the saved-scan limit', () => {
    const coverage = new ScanCoverage();
    centred(coverage);
    const d = 0.3, p = d / PITCH_SCALE;
    const poses = [[d, 0], [d, p], [0, p], [-d, p], [-d, 0], [-d, -p], [0, -p], [d, -p]];
    poses.forEach(([yaw, pitch], i) => {
      expect(coverage.complete).toBe(false);
      coverage.offer(vec(0.2 + i * 0.01), { yaw: yaw!, pitch: 0.56 + pitch! });
    });
    expect(coverage.complete).toBe(true);
    expect(coverage.filled).toEqual(Array.from({ length: SCAN_BINS }, () => true));
    const far = 3;
    expect(coverage.centerDescriptors().length + coverage.angleDescriptors().length + far).toBeLessThanOrEqual(FACE_MAX_DESCRIPTORS);
  });
});

describe('who is being scanned', () => {
  const face = (width: number) => ({ box: { x: 0, y: 0, width, height: width }, score: 0.9 });

  it('picks the largest face and ignores people well behind', () => {
    expect(primaryFace([face(60), face(200)])?.box.width).toBe(200);
    expect(primaryFace([face(200), face(150)])).toBeNull();
    expect(primaryFace([])).toBeNull();
  });

  it('asks to move closer relative to the frame, not a fixed size', () => {
    expect(scanProblem([face(90)], { width: 640, height: 480 })).toBeNull();
    expect(scanProblem([face(70)], { width: 640, height: 480 })).toMatch(/closer/);
    expect(scanProblem([face(120)], { width: 1920, height: 1080 })).toMatch(/closer/);
    expect(scanProblem([face(200), face(60)], { width: 640, height: 480 })).toBeNull();
    expect(scanProblem([face(200), face(160)], { width: 640, height: 480 })).toMatch(/Only the person/);
  });

  it('does not ask a turned head for a frontal-quality score', () => {
    const turned = [{ ...face(200), score: 0.52 }];
    expect(scanProblem(turned, { width: 640, height: 480 })).toMatch(/good light/);
    expect(scanProblem(turned, { width: 640, height: 480 }, true)).toBeNull();
  });
});

describe('wireframe', () => {
  it('connects every landmark with valid, unique edges', () => {
    const seen = new Set<string>(), used = new Set<number>();
    for (const [a, b] of MESH_EDGES) {
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(LANDMARK_COUNT);
      expect(seen.has(`${a}-${b}`)).toBe(false);
      seen.add(`${a}-${b}`); used.add(a); used.add(b);
    }
    expect(used.size).toBe(LANDMARK_COUNT);
    expect(MESH_EDGES.length).toBeGreaterThan(120);
  });
});
