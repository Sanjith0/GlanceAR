import { BrowserRecorder, browserAudioSupported } from './browserAudio';

/**
 * Browser implementation of the native audio-capture contract used by
 * CaptureController, so live conversations can record from a phone or laptop
 * browser. Audio stays in memory as one 16 kHz mono WAV until the controller
 * uploads or deletes it. The lease mirrors the native module: capture stops on
 * its own if the server lease is not renewed in time.
 */
export type AudioStoppedEvent = { reason: string; uri: string | null; captureID: string };
export type AudioCaptureResult = { uri: string | null; mimeType: 'audio/wav' };

const recorder = new BrowserRecorder();
const listeners = new Set<(event: AudioStoppedEvent) => void>();
let lease: { captureID: string; timer: ReturnType<typeof setTimeout> } | null = null;

const now = () => performance.now();

function clearLease(captureID?: string) {
  if (!lease || (captureID && lease.captureID !== captureID)) return;
  clearTimeout(lease.timer);
  lease = null;
}

async function finish(captureID: string): Promise<string | null> {
  clearLease(captureID);
  const wav = await recorder.stop(captureID);
  return wav ? URL.createObjectURL(wav) : null;
}

/** The lease ticket is a monotonic timestamp; every lease is charged from it. */
function armLease(leaseMs: number, ticket: string, captureID: string) {
  const issuedAt = Number(ticket);
  if (!Number.isFinite(issuedAt)) throw new Error('Invalid audio lease ticket.');
  const remaining = issuedAt + leaseMs - now();
  if (remaining <= 0) throw new Error('The recording lease expired. Keep this screen open and retry.');
  clearLease();
  lease = {
    captureID,
    timer: setTimeout(() => {
      void finish(captureID).then(uri => listeners.forEach(listener => listener({ reason: 'lease_expired', uri, captureID })));
    }, remaining),
  };
}

export function isAudioCaptureAvailable(): boolean { return browserAudioSupported(); }

export async function requestAudioPermission(): Promise<boolean> {
  if (!browserAudioSupported()) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch {
    return false;
  }
}

/** Confirms microphone access; never starts recording. */
export async function prepareAudioCapture(_captureID: string): Promise<void> {
  if (!browserAudioSupported()) throw new Error('This browser cannot record audio. Use Safari or Chrome over HTTPS.');
  if (!await requestAudioPermission()) throw new Error('Microphone access is off. Allow it for this site in your browser settings, then retry.');
}

export async function createAudioLeaseTicket(): Promise<string> { return String(now()); }

export async function startAudioCapture(leaseMs: number, ticket: string, captureID: string): Promise<void> {
  if (!browserAudioSupported()) throw new Error('This browser cannot record audio.');
  await recorder.start(captureID);
  try {
    armLease(leaseMs, ticket, captureID);
  } catch (error) {
    recorder.discard(captureID);
    throw error;
  }
}

export async function renewAudioLease(leaseMs: number, ticket: string, captureID: string): Promise<void> {
  if (!recorder.isRecording(captureID)) throw new Error('This browser is no longer recording.');
  armLease(leaseMs, ticket, captureID);
}

export async function stopAudioCapture(captureID: string): Promise<AudioCaptureResult> {
  return { uri: await finish(captureID), mimeType: 'audio/wav' };
}

export function subscribeAudioStopped(listener: (event: AudioStoppedEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function deleteAudioCapture(uri: string): Promise<void> {
  if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
}
