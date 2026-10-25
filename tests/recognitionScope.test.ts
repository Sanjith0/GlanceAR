import { describe, expect, it } from 'vitest';
import { RecognitionScope, sameRecognitionRegistry } from '../src/recognitionScope';

const first = {}, second = {}, replacement = {};
const registry = [
  { profileId: 'self', descriptors: first },
  { profileId: 'peer', descriptors: second },
];

describe('recognition scope fence', () => {
  it('keeps a hold through recreated/reordered query wrappers without examining template values', () => {
    const scope = new RecognitionScope();
    expect(scope.update('same event/actor/permission', registry, 100)).toBe(true);
    const generation = scope.generation;
    expect(scope.update('same event/actor/permission', [
      { profileId: 'peer', descriptors: second },
      { profileId: 'self', descriptors: first },
    ], 900)).toBe(false);
    expect(scope.isCurrent(generation)).toBe(true);
    expect(scope.acceptsFrame(200)).toBe(true);
  });

  it('invalidates an attempt and in-flight frame after replacing the same attendee scan', () => {
    const scope = new RecognitionScope();
    scope.update('event', registry, 100);
    const oldAttempt = scope.generation;
    expect(scope.update('event', [
      registry[0], { profileId: 'peer', descriptors: replacement },
    ], 4000)).toBe(true);
    expect(scope.isCurrent(oldAttempt)).toBe(false);
    expect(scope.acceptsFrame(3999)).toBe(false);
    expect(scope.acceptsFrame(4000)).toBe(true);
  });

  it('resets when a scan is removed or re-enrolled even if its ID is unchanged', () => {
    const scope = new RecognitionScope();
    scope.update('event', registry, 10);
    expect(scope.update('event', [registry[0]], 20)).toBe(true);
    expect(scope.update('event', registry, 30)).toBe(true);
    expect(scope.acceptsFrame(25)).toBe(false);
  });

  it.each(['other event', 'other actor', 'permission off', 'unfocused', 'other mode', 'new model'])(
    'invalidates a pending pairing result for a changed context: %s', key => {
      const scope = new RecognitionScope();
      scope.update('original', registry, 100);
      const pending = scope.generation;
      expect(scope.update(key, registry, 500)).toBe(true);
      expect(scope.isCurrent(pending)).toBe(false);
      expect(scope.acceptsFrame(499)).toBe(false);
    },
  );

  it('fences camera restart and scan controls without changing the registry', () => {
    const scope = new RecognitionScope();
    scope.update('event', registry, 100);
    const pending = scope.generation;
    scope.invalidate(300);
    expect(scope.isCurrent(pending)).toBe(false);
    expect(scope.acceptsFrame(299)).toBe(false);
    expect(scope.acceptsFrame(Number.NaN)).toBe(false);
    expect(scope.acceptsFrame(Number.POSITIVE_INFINITY)).toBe(false);
    expect(scope.update('event', registry, 400)).toBe(false);
    expect(scope.acceptsFrame(350)).toBe(true);
  });

  it('does not equate a duplicate or different attendee list with the original registry', () => {
    expect(sameRecognitionRegistry(registry, [registry[0], registry[0]])).toBe(false);
    expect(sameRecognitionRegistry(registry, [
      registry[0], { profileId: 'different peer', descriptors: second },
    ])).toBe(false);
  });
});
