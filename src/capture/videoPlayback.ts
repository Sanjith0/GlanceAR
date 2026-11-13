/**
 * Starting a camera <video> element.
 *
 * A browser can refuse `play()` for reasons that have nothing to do with camera
 * permission: no tap came before it (a screen that opened by itself), or the system's
 * audio is briefly interrupted (a microphone starting, a headset changing mode). It
 * raises the same NotAllowedError a denied camera does, so the two must not be confused,
 * and a refusal is usually over a moment later. This keeps trying before giving up.
 */
export const PLAYBACK_ATTEMPTS = 20;
export const PLAYBACK_RETRY_MS = 400;

/** Thrown when the browser would not start the video after every attempt. */
export class PlaybackBlocked extends Error {
  constructor() { super('The browser did not start the live view.'); this.name = 'PlaybackBlocked'; }
}

/**
 * Resolves once the video is playing. Throws PlaybackBlocked if the browser refused
 * every attempt. Stops quietly (resolving false) when `isCurrent` turns false.
 */
export async function startVideo(
  element: Pick<HTMLVideoElement, 'play' | 'paused'>, isCurrent: () => boolean,
  attempts = PLAYBACK_ATTEMPTS, waitMs = PLAYBACK_RETRY_MS,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { await element.play(); return true; } catch { /* refused for now */ }
    if (!isCurrent()) return false;
    // The autoplay attribute may have started it even though this call was refused.
    if (!element.paused) return true;
    await new Promise<void>(resolve => setTimeout(resolve, waitMs));
    if (!isCurrent()) return false;
  }
  throw new PlaybackBlocked();
}
