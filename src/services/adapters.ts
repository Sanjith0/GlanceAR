import type {
  FaceEnrollmentAdapter, FaceEnrollmentResult, LinkedInImport, LinkedInImportAdapter,
  RecognitionAdapter, RecognitionPhase,
} from './contracts';
import { FACE_ANGLES } from '../ui/Arch';
import { sampleLinkedInImport } from '../fixtures/connections';

export type FaceScanScenario = 'success' | 'interrupted' | 'unavailable';
export type LinkedInScenario = 'success' | 'empty' | 'error';

/**
 * Sample face enrollment. Plays the three-angle capture over ~5 seconds and
 * resolves with a clearly labelled sample result. Nothing touches the camera.
 * Production: replace with a camera-backed adapter whose success response is the
 * existing `saveFaceScan` contract plus a captured still for the portrait.
 */
export function createSampleFaceEnrollment(options: { scenario: () => FaceScanScenario; portraitUrl: string }): FaceEnrollmentAdapter {
  return {
    async availability() { return options.scenario() === 'unavailable' ? 'unavailable' : 'available'; },
    enroll(onStep, signal) {
      const scenario = options.scenario();
      if (scenario === 'unavailable') { onStep({ kind: 'unavailable', reason: 'No camera is available on this device.' }); return; }
      const captured: typeof FACE_ANGLES[number]['key'][] = [];
      let angleIndex = 0, progress = 0;
      const tick = () => {
        if (signal.aborted) return;
        progress += 0.08;
        if (scenario === 'interrupted' && angleIndex === 1 && progress > 0.5) {
          onStep({ kind: 'interrupted', reason: 'We lost your face for a moment. Hold still and try again.' });
          return;
        }
        if (progress >= 1) {
          captured.push(FACE_ANGLES[angleIndex].key);
          angleIndex += 1; progress = 0;
          if (angleIndex >= FACE_ANGLES.length) {
            const result: FaceEnrollmentResult = { templateId: `sample-${Date.now().toString(36)}`, portraitUrl: options.portraitUrl, capturedAt: Date.now(), sample: true };
            onStep({ kind: 'success', result });
            return;
          }
        }
        onStep({ kind: 'capturing', angle: FACE_ANGLES[angleIndex].key, progress, captured: [...captured] });
        timer = setTimeout(tick, 140);
      };
      let timer = setTimeout(tick, 400);
      onStep({ kind: 'capturing', angle: 'front', progress: 0, captured: [] });
      signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    },
    async remove() { /* sample templates live only in memory */ },
  };
}

/** Sample LinkedIn import; the real adapter would call the team's LinkedIn retrieval service. */
export function createSampleLinkedInImport(scenario: () => LinkedInScenario): LinkedInImportAdapter {
  return {
    importProfile: () => new Promise<LinkedInImport>((resolve, reject) => {
      setTimeout(() => {
        const mode = scenario();
        if (mode === 'error') reject(new Error('LinkedIn did not respond. Your manual entries are untouched; try again or skip.'));
        else if (mode === 'empty') resolve({ ...sampleLinkedInImport, interests: [], facts: [], headline: '', occupation: '' });
        else resolve(sampleLinkedInImport);
      }, 900);
    }),
  };
}

/**
 * Scripted recognition. The real adapter maps camera detections and the face
 * directory into the same `RecognitionPhase` values; the screens never know
 * which one they are talking to.
 */
export function createSampleRecognition(): RecognitionAdapter {
  return {
    start({ candidates, scenario, startIndex }, onPhase) {
      let cancelled = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const at = (delay: number, phase: RecognitionPhase) => { timers.push(setTimeout(() => { if (!cancelled) onPhase(phase); }, delay)); };
      onPhase({ phase: 'preparing' });
      if (scenario === 'permission') { at(500, { phase: 'permission', reason: 'Camera access is off for this app.' }); }
      else if (scenario === 'error') { at(700, { phase: 'error', message: 'The recognition model could not load.' }); }
      else {
        at(700, { phase: 'searching' });
        if (scenario === 'unknown' || candidates.length === 0) at(2300, { phase: 'unknown' });
        else if (scenario === 'uncertain') at(2300, { phase: 'uncertain', candidates: candidates.slice(0, 2).map(c => c.person) });
        else at(2300, { phase: 'recognized', suggestion: candidates[startIndex % candidates.length] });
      }
      return () => { cancelled = true; timers.forEach(clearTimeout); };
    },
  };
}
