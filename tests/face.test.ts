import { describe, expect, it } from 'vitest';
import {
  compactDescriptor, consistentSamples, matchDescriptor, projectBox, RecognitionTracker, scanProblem, validDescriptors,
} from '../src/face';
import { talkingPoints } from '../src/talkingPoints';
import { demoFaceDirectory, demoReducer, initialDemo } from '../src/demo';

function face(person: number, sample = 0): number[] {
  let seed = person * 7919 + 1;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const base = Array.from({ length: 128 }, () => (next() - 0.5) * 0.18);
  let noise = person * 104729 + sample * 31 + 7;
  return base.map(x => { noise = (noise * 48271) % 2147483647; return x + (noise / 2147483647 - 0.5) * 0.02; });
}
const box = { x: 100, y: 80, width: 160, height: 160 };

describe('face matching', () => {
  const templates = [0, 1, 2, 3, 4].map(p => ({ profileId: `p${p}`, descriptors: [0, 1, 2].map(i => face(p, i)) }));
  it('identifies each of five enrolled people and rejects strangers', () => {
    for (let p = 0; p < 5; p++) expect(matchDescriptor(face(p, 7), templates)?.profileId).toBe(`p${p}`);
    expect(matchDescriptor(face(9), templates)).toBeNull();
    expect(matchDescriptor(face(0), [])).toBeNull();
  });
  it('refuses ambiguous matches between two near-identical templates', () => {
    expect(matchDescriptor(face(0, 5), [...templates, { profileId: 'twin', descriptors: [face(0, 6)] }])).toBeNull();
  });
  it('validates descriptor shape and keeps four decimals', () => {
    expect(validDescriptors([face(0)])).toBe(true);
    expect(validDescriptors([])).toBe(false);
    expect(validDescriptors([face(0).slice(1)])).toBe(false);
    expect(validDescriptors([[...face(0).slice(1), Number.NaN]])).toBe(false);
    expect(compactDescriptor([0.123456, -0.98766])).toEqual([0.1235, -0.9877]);
  });
  it('accepts consistent scan samples and rejects mixed people', () => {
    expect(consistentSamples([face(0, 0), face(0, 1), face(0, 2)])).toBe(true);
    expect(consistentSamples([face(0, 0), face(1, 1), face(0, 2)])).toBe(false);
  });
  it('explains unusable scan frames', () => {
    expect(scanProblem([])).toMatch(/No face/);
    expect(scanProblem([{ box, score: 0.9 }, { box, score: 0.9 }])).toMatch(/Only the person/);
    expect(scanProblem([{ box: { ...box, width: 60 }, score: 0.9 }])).toMatch(/closer/);
    expect(scanProblem([{ box, score: 0.9 }])).toBeNull();
  });
});

describe('recognition stability', () => {
  it('needs several hits over time and forgets people after a gap', () => {
    const tracker = new RecognitionTracker();
    expect(tracker.observe(['sam'], 0)).toEqual([]);
    expect(tracker.observe(['sam'], 250)).toEqual([]);
    expect(tracker.observe(['sam'], 500)).toEqual([]);
    expect(tracker.observe(['sam'], 700)).toEqual(['sam']);
    expect(tracker.observe([], 900)).toEqual([]);
    expect(tracker.observe(['sam'], 3_000)).toEqual([]);
  });
});

describe('overlay projection', () => {
  it('maps object-fit cover coordinates and mirrors the front camera', () => {
    // 1280x720 video in a 400x440 view: scale by height, crop the sides.
    const scale = 440 / 720, offset = (400 - 1280 * scale) / 2;
    const plain = projectBox(box, { width: 1280, height: 720 }, { width: 400, height: 440 }, false);
    expect(plain.x).toBeCloseTo(offset + 100 * scale);
    expect(plain.y).toBeCloseTo(80 * scale);
    expect(plain.width).toBeCloseTo(160 * scale);
    const mirrored = projectBox(box, { width: 1280, height: 720 }, { width: 400, height: 440 }, true);
    expect(mirrored.x).toBeCloseTo(400 - (offset + 260 * scale));
  });
});

describe('talking points', () => {
  it('builds starters from both introductions without inventing facts', () => {
    expect(talkingPoints({ role: 'Builder · human-centered AI' }, { role: 'Designer · creative tools' }, 'Builders, after hours'))
      .toEqual(['Ask what they’re working on as a designer', 'Ask about creative tools', 'Ask what brought them to Builders, after hours']);
    expect(talkingPoints({ role: 'Founder, climate tools' }, { role: 'Engineer, climate data' })[0]).toBe('You both mention climate');
    expect(talkingPoints(undefined, { role: '' })).toEqual(['Ask what brought them here']);
  });
});

describe('preview face database', () => {
  it('caps the event at five people, mirrors server rules and erases scans on request', () => {
    let state = initialDemo();
    for (let i = 0; i < 4; i++) state = demoReducer(state, { type: 'addPerson', eventId: 'builders',
      profile: { id: `guest${i}`, name: `Guest ${i}`, role: 'Builder', photoUrl: 'data:image/jpeg;base64,/9j/' } });
    expect(state.memberships.builders).toHaveLength(5);
    expect(state.eventPermissions.builders).toContain('guest2');
    state = demoReducer(state, { type: 'faceScan', profileId: 'sam', descriptors: [face(1)] });
    state = demoReducer(state, { type: 'faceScan', profileId: 'alex', descriptors: [face(0)] });
    state = demoReducer(state, { type: 'faceScan', profileId: 'nobody', descriptors: [face(2)] });
    state = demoReducer(state, { type: 'faceScan', profileId: 'guest0', descriptors: [[1, 2, 3]] });
    expect(demoFaceDirectory(state, 'builders')).toMatchObject({ enabled: true, scanned: true });
    expect(demoFaceDirectory(state, 'builders').templates.map(t => t.profileId)).toEqual(['alex', 'sam']);
    state = demoReducer(state, { type: 'eventPermission', eventId: 'builders', enabled: false });
    expect(demoFaceDirectory(state, 'builders').templates).toEqual([]);
    state = demoReducer(state, { type: 'faceScanDelete', profileId: 'alex' });
    expect(demoFaceDirectory(state, 'builders').scanned).toBe(false);
  });
});
