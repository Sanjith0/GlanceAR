import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from './components';
import { s } from './theme';
import FaceCamera, { type FaceFrame, type ScanGuide } from './capture/FaceCamera';
import { keepFarSamples, scanProblem } from './face';
import { headPose, primaryFace, ScanCoverage, SCAN_BINS } from './faceScan';
import { FACE_SCAN_SAMPLES } from './domain';

/**
 * The guided face scan, shared by event registration and the Dev tab: a wireframe
 * on the face inside a circle, three straight-on samples, then a ring that fills as
 * the head moves around. The camera is on only while this is mounted and `active`.
 */
export type ScanResult = {
  /** Straight-on samples that agreed with each other. */
  center: number[][];
  /** One sample per head direction reached, when it still resembled the straight-on face. */
  angles: number[][];
  /** Distant-looking samples; drawn before the camera closed, read in the background. */
  far: Promise<number[][]>;
  /** A loose crop of the face, only when `wantPortrait` is set. */
  portrait?: string;
};
export type ScanStop = { text: string; error?: boolean };

/**
 * The sample sets to try saving, most complete first. A backend that has not been
 * redeployed accepts fewer samples and answers "incomplete", so callers fall back.
 */
export async function scanSampleSets(result: ScanResult): Promise<number[][][]> {
  const far = keepFarSamples(result.center, await result.far.catch(() => [] as number[][]));
  return [[...result.center, ...result.angles, ...far], [...result.center, ...far], result.center]
    .filter((set, index, all) => index === 0 || set.length < all[index - 1]!.length);
}

/** Saves the most complete set the backend accepts. */
export async function saveScanSets(result: ScanResult, save: (descriptors: number[][]) => Promise<unknown>): Promise<void> {
  const sets = await scanSampleSets(result);
  for (const [index, set] of sets.entries()) {
    try { await save(set); return; } catch (error) {
      // The backend's reason arrives as the error's data, its message, or both.
      const said = `${String((error as { data?: unknown } | null)?.data ?? '')} ${error instanceof Error ? error.message : ''}`;
      const retry = index < sets.length - 1 && /incomplete/i.test(said);
      if (!retry) throw error;
    }
  }
}

type Run = {
  coverage: ScanCoverage; lastAt: number; startedAt: number; portrait?: string;
  /** Set when the straight-on step finishes and the ring step begins. */
  turningSince?: number;
  far?: Promise<number[][]>;
  /** The last frame showed a problem message, so the next good frame restores the guidance. */
  blocked?: boolean;
  done?: boolean;
};
type Step = { step: 'center' | 'turn'; count: number; filled: number; hint: string };

/** The straight-on step fails after this long; nothing is saved. */
const SCAN_TIMEOUT_MS = 25_000;
/** The ring step ends after this long and returns what it has, so nobody gets stuck on it. */
const TURN_TIMEOUT_MS = 30_000;
const CENTER_HINT = 'Fit your face in the circle and look straight at the camera.';
const TURN_HINT = 'Slowly move your head in a circle to fill the ring.';
const emptyBins = () => Array.from({ length: SCAN_BINS }, () => false);
const idleGuide: ScanGuide = { landmarks: null, bins: emptyBins(), centerProgress: 0, aim: null };
const firstStep: Step = { step: 'center', count: 0, filled: 0, hint: CENTER_HINT };

export function GuidedFaceScan({ active, scopeId, running, preferFront = false, wantPortrait = false, size, clash, onDone, onStop, children }: {
  /** Camera on. Turn off (or unmount) to release it. */
  active: boolean;
  scopeId: string;
  /** False shows only the wireframe preview, with `children` below; true runs the scan. */
  running: boolean;
  preferFront?: boolean;
  wantPortrait?: boolean;
  size: number;
  /** Returns a message when these straight-on samples belong to someone already registered. */
  clash?: (center: number[][]) => string | null;
  onDone: (result: ScanResult) => void;
  /** The scan ended without a result: cancelled, timed out or refused. */
  onStop: (reason: ScanStop) => void;
  /** Shown under the camera while not running (for example, name fields and a Start button). */
  children?: React.ReactNode;
}) {
  const [guide, setGuide] = useState<ScanGuide>(idleGuide);
  const [step, setStep] = useState<Step>(firstStep);
  const run = useRef<Run | null>(null);
  // A new scan every time `running` turns on; nothing carries over from the last one.
  const [wasRunning, setWasRunning] = useState(running);
  if (wasRunning !== running) {
    setWasRunning(running);
    setGuide(idleGuide);
    setStep(firstStep);
  }
  useEffect(() => {
    run.current = running ? { coverage: new ScanCoverage(), lastAt: 0, startedAt: 0 } : null;
    return () => { run.current = null; };
  }, [running]);

  const finish = useCallback(() => {
    const current = run.current;
    if (!current?.coverage.centerDone || current.done) return;
    current.done = true;
    onDone({
      center: current.coverage.centerDescriptors(), angles: current.coverage.angleDescriptors(),
      far: current.far ?? Promise.resolve([]), ...(current.portrait ? { portrait: current.portrait } : {}),
    });
  }, [onDone]);
  const stop = useCallback((reason: ScanStop) => {
    if (run.current) run.current.done = true;
    onStop(reason);
  }, [onStop]);

  const onFrame = useCallback((frame: FaceFrame) => {
    const current = run.current;
    const face = primaryFace(frame.faces);
    if (!current) {
      // Not scanning yet: show the wireframe so the person can line up first.
      setGuide({ ...idleGuide, landmarks: face?.landmarks ?? null });
      return;
    }
    if (current.done) return;
    const now = Date.now();
    if (!current.startedAt) current.startedAt = now;
    const { coverage } = current;
    const turning = coverage.centerDone;
    const show = (aim: number | null = null) => setGuide({
      landmarks: face?.landmarks ?? null, bins: coverage.filled, aim,
      centerProgress: turning ? 1 : coverage.centerCount / FACE_SCAN_SAMPLES,
    });
    const say = (hint: string) => setStep({
      step: coverage.centerDone ? 'turn' : 'center', count: coverage.centerCount, filled: coverage.filledCount, hint,
    });
    if (turning ? now - (current.turningSince ?? now) > TURN_TIMEOUT_MS : now - current.startedAt > SCAN_TIMEOUT_MS) {
      if (turning) finish();
      else stop({ text: 'The scan timed out. Try again facing the camera in good light.', error: true });
      return;
    }
    const problem = scanProblem(frame.faces, { width: frame.width, height: frame.height }, turning);
    if (problem || !face) {
      show();
      current.blocked = true;
      // Mid-turn, losing the face nearly always means the head went too far round.
      say(turning && !frame.faces.length ? 'Too far. Come back toward the camera a little.'
        : problem ?? 'Only the person being scanned should be in frame.');
      return;
    }
    const pose = headPose(face.landmarks);
    if (!pose) { show(); return; }
    // A problem message must not outlive the problem.
    if (current.blocked) { current.blocked = false; say(turning ? TURN_HINT : CENTER_HINT); }

    if (turning) {
      const { bin, added } = coverage.offer(face.descriptor, pose);
      show(bin);
      if (coverage.complete) { finish(); return; }
      if (added) say(coverage.filledCount >= SCAN_BINS - 2 ? 'Almost there. Fill the last ticks.' : 'Keep going around the circle.');
      return;
    }

    show();
    if (!face.descriptor || now - current.lastAt < 300) return;
    const result = coverage.addCenter(face.descriptor, pose);
    if (result === 'turned') { say('Look straight at the camera.'); return; }
    current.lastAt = now;
    if (wantPortrait && !current.portrait) current.portrait = frame.crop(face.box);
    if (result === 'more') { say('Hold still…'); return; }
    if (result === 'restart') {
      current.portrait = undefined;
      say('Those frames didn’t look like one person. Hold still; starting over.');
      return;
    }
    // One face, one person: never continue with a scan that already matches someone else.
    const taken = clash?.(coverage.centerDescriptors());
    if (taken) { stop({ text: taken, error: true }); return; }
    // Draw the distant-looking samples from this straight-on frame now; they are read in the background.
    current.far = frame.farSamples(face.box).catch(() => [] as number[][]);
    current.turningSince = now;
    setGuide({ landmarks: face.landmarks ?? null, bins: coverage.filled, aim: null, centerProgress: 1 });
    say(TURN_HINT);
  }, [finish, stop, clash, wantPortrait]);

  const square = { width: size, height: size };
  return <>
    <View style={[square, { alignSelf: 'center', borderRadius: 20, overflow: 'hidden' }]}>
      <FaceCamera active={active} scopeId={scopeId} overlays={[]} guide={guide} fast preferFront={preferFront}
        onFrame={onFrame} style={square} />
    </View>
    {!running ? children : <View style={[s.soft, { gap: 12 }]}>
      <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
        <Text testID="scan-step" style={s.label}>{step.step === 'center'
          ? `Step 1 of 2 · Look straight ahead (${step.count}/${FACE_SCAN_SAMPLES})`
          : `Step 2 of 2 · Move your head in a circle (${step.filled}/${SCAN_BINS})`}</Text>
        <Text testID="scan-hint" style={s.small}>{step.hint}</Text>
      </View>
      <View style={s.row}>
        {step.step === 'turn' && <View style={s.grow}><Button testID="scan-finish" icon="check" onPress={finish}>
          {step.filled > 0 ? 'Finish' : 'Skip'}</Button></View>}
        <View style={s.grow}><Button tone="ghost" onPress={() => stop({ text: 'Scan cancelled. Nothing was saved.' })}>Cancel</Button></View>
      </View>
      {step.step === 'turn' && <Text style={s.small}>More of the ring means you are recognized from more angles. You can finish at any point.</Text>}
    </View>}
  </>;
}
