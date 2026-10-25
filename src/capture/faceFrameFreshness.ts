/** Capture transport only. Detection, descriptors and matching remain outside this module. */
export type FreshFaceFrame<Face> = {
  faces: Face[];
  width: number;
  height: number;
  sampledAt: number;
};

/**
 * Serial 120ms frame scheduling with capture-time timestamps and scope fences.
 * The supplied detector is unchanged; a repeated video frame is never inferred
 * again just because a later wall-clock delivery could complete a countdown.
 */
export function startFreshFaceFrames<Face>(options: {
  video: HTMLVideoElement;
  detectFaces: (video: HTMLVideoElement) => Promise<Face[]>;
  isCurrent: () => boolean;
  isLive: () => boolean;
  isVisible: () => boolean;
  onFrame: (frame: FreshFaceFrame<Face>) => void;
  onReset: () => void;
  onStopped: () => void;
  onError: (error: unknown) => void;
}) {
  let stopped = false;
  let lastVideoTime = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = () => !stopped && options.isCurrent();
  const usable = () => options.isLive() && options.isVisible();
  const reset = () => { if (current()) options.onReset(); };
  const loop = async () => {
    if (!current()) return;
    if (!usable()) { reset(); if (current()) options.onStopped(); return; }
    try {
      const video = options.video;
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        const videoTime = video.currentTime;
        // A slow video source may legitimately repeat a timestamp. Drop it;
        // the parent's freshness watchdog, not one duplicate, expires a hold.
        if (Number.isFinite(videoTime) && videoTime >= 0 && videoTime > lastVideoTime) {
          lastVideoTime = videoTime;
          const width = video.videoWidth, height = video.videoHeight;
          const sampledAt = performance.now();
          const faces = await options.detectFaces(video);
          if (!current()) return;
          if (!usable()) { reset(); if (current()) options.onStopped(); return; }
          options.onFrame({ faces, width, height, sampledAt });
        }
      }
    } catch (error) {
      if (current()) { reset(); if (current()) options.onError(error); }
      return;
    }
    if (current()) timer = setTimeout(() => { void loop(); }, 120);
  };
  void loop();
  return () => { stopped = true; clearTimeout(timer); };
}
