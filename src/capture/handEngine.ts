import type { HandSample } from '../handGesture';

export type HandEngine = {
  detect(video: HTMLVideoElement, timestamp: number): HandSample[];
  close(): void;
};

/** Same-origin pinned assets; frames and hand coordinates never leave this device. */
export async function createHandEngine(): Promise<HandEngine> {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const base = new URL('models/hand-landmarker/', window.location.href.split('#')[0]);
  const files = await FilesetResolver.forVisionTasks(new URL('wasm/', base).href.replace(/\/$/, ''));
  const model = await HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: new URL('hand_landmarker.task', base).href, delegate: 'CPU' },
    runningMode: 'VIDEO',
    // Detect one extra hand so a third hand cannot be silently reduced to a valid pair.
    numHands: 3, minHandDetectionConfidence: 0.65, minHandPresenceConfidence: 0.65, minTrackingConfidence: 0.65,
  });
  return {
    detect(video, timestamp) {
      const result = model.detectForVideo(video, timestamp);
      return result.landmarks.map((landmarks, index) => ({ landmarks, worldLandmarks: result.worldLandmarks[index] }));
    },
    close: () => model.close(),
  };
}

/**
 * Own one model and serial inference loop. Cancellation closes late-loading models;
 * repeated/stalled video frames cannot accumulate hold time.
 *
 * With `recover`, a model that fails mid-run is closed and rebuilt, up to that many times
 * in a row, before `onError` is reported. A phone that locked its screen or ran short of
 * memory can lose the model for a moment; that should not end hand detection for good.
 * The count starts again after a run of good frames, so this never retries without bound.
 */
export function startHandTracking(options: {
  video: HTMLVideoElement;
  create?: () => Promise<HandEngine>;
  isCurrent?: () => boolean;
  isLive?: () => boolean;
  onReady?: () => void;
  onFrame: (hands: HandSample[], timestamp: number) => void;
  onError: (error: unknown) => void;
  /** How many rebuilds in a row to try after a failure. Default 0: fail on the first error. */
  recover?: number;
  /** Told each time a rebuild begins, with its number (1, 2, …). */
  onRecovering?: (attempt: number) => void;
}) {
  let cancelled = false, engine: HandEngine | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastFrame = -1;
  let rebuilds = 0, goodFrames = 0;
  const current = () => !cancelled && (options.isCurrent?.() ?? true);
  const failed = (error: unknown) => {
    engine?.close(); engine = null;
    if (!current()) return;
    // A stopped camera is not something a new model can fix.
    const cameraLive = !options.isLive || options.isLive();
    if (cameraLive && rebuilds < (options.recover ?? 0)) {
      rebuilds += 1; goodFrames = 0;
      lastFrame = -1; // the new model looks at the current frame, even if the picture has not moved on
      options.onRecovering?.(rebuilds);
      timer = setTimeout(build, 600 * rebuilds);
      return;
    }
    options.onError(error);
  };
  const loop = () => {
    if (!current()) { engine?.close(); engine = null; return; }
    if (!engine) return;
    try {
      if (options.isLive && !options.isLive()) throw new Error('The camera stream ended');
      const video = options.video;
      if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastFrame) {
        lastFrame = video.currentTime;
        const now = performance.now();
        const hands = engine.detect(video, now);
        goodFrames += 1;
        if (goodFrames >= 30) rebuilds = 0; // it has been healthy for a while
        if (current()) options.onFrame(hands, now);
      }
    } catch (error) {
      failed(error);
      return;
    }
    if (current()) timer = setTimeout(loop, 90);
    else { engine?.close(); engine = null; }
  };
  function build() {
    void (options.create ?? createHandEngine)().then(created => {
      if (!current()) { created.close(); return; }
      engine = created;
      options.onReady?.();
      loop();
    }).catch(error => { if (current()) failed(error); });
  }
  build();
  return () => {
    cancelled = true;
    clearTimeout(timer);
    engine?.close(); engine = null;
  };
}
