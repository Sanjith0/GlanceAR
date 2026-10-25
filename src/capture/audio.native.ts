import { Platform } from 'react-native';
import GlanceAudio, {
  type AudioCaptureResult,
  type AudioStoppedEvent,
} from '../../modules/glance-audio';

export type { AudioCaptureResult, AudioStoppedEvent };

function requiredModule() {
  if (Platform.OS !== 'ios' || !GlanceAudio) {
    throw new Error('Guarded microphone capture requires an iPhone development build with GlanceAudio. Expo Go and Android are not supported.');
  }
  return GlanceAudio;
}

export function isAudioCaptureAvailable(): boolean {
  return Platform.OS === 'ios' && GlanceAudio !== null;
}

/** Event-entry preflight only. Never configures the audio session or starts a recorder. */
export async function requestAudioPermission(): Promise<boolean> {
  if (!isAudioCaptureAvailable()) return false;
  return requiredModule().requestPermission();
}

/** Call only after BOTH participants have explicitly consented. Never starts recording. */
export async function prepareAudioCapture(captureID: string): Promise<void> {
  await requiredModule().prepare(captureID);
}

/** Mint BEFORE the server request. Native retains the monotonic anchor. */
export async function createAudioLeaseTicket(): Promise<string> {
  return requiredModule().createLeaseTicket();
}

/** Raw server duration, not JS-adjusted RTT; native charges all ticket elapsed time. */
export async function startAudioCapture(leaseMs: number, ticket: string, captureID: string): Promise<void> {
  await requiredModule().start(leaseMs, ticket, captureID);
}

/** Caller must discard stale/out-of-order heartbeats and never reuse a response across captures. */
export async function renewAudioLease(leaseMs: number, ticket: string, captureID: string): Promise<void> {
  await requiredModule().renew(leaseMs, ticket, captureID);
}

export async function stopAudioCapture(captureID: string): Promise<AudioCaptureResult> {
  // Safe cleanup on an unsupported platform, with no pretend recording.
  if (!isAudioCaptureAvailable()) return { uri: null, mimeType: 'audio/wav' };
  return requiredModule().stop(captureID);
}

export function subscribeAudioStopped(
  listener: (event: AudioStoppedEvent) => void,
): () => void {
  if (!isAudioCaptureAvailable()) return () => {};
  const subscription = requiredModule().addListener('onAudioStopped', listener);
  return () => subscription.remove();
}

export async function deleteAudioCapture(uri: string): Promise<void> {
  await requiredModule().delete(uri);
}
