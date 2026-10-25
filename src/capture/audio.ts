export type AudioStoppedEvent = { reason: string; uri: string | null; captureID: string };
export type AudioCaptureResult = { uri: string | null; mimeType: 'audio/wav' };
export async function prepareAudioCapture(_captureID: string): Promise<void> { throw new Error('Live audio capture needs the iPhone development build. The web preview never records audio.'); }
export async function createAudioLeaseTicket(): Promise<string> { throw new Error('Native audio lease tickets are unavailable on web.'); }
export async function startAudioCapture(_leaseMs: number, _ticket: string, captureID: string): Promise<void> { await prepareAudioCapture(captureID); }
export async function renewAudioLease(_leaseMs: number, _ticket: string, _captureID: string): Promise<void> { throw new Error('Native audio leases are unavailable on web.'); }
export async function stopAudioCapture(_captureID: string): Promise<AudioCaptureResult> { return { uri: null, mimeType: 'audio/wav' }; }
export function subscribeAudioStopped(_listener: (event: AudioStoppedEvent) => void): () => void { return () => {}; }
export function isAudioCaptureAvailable(): boolean { return false; }
export async function deleteAudioCapture(_uri: string): Promise<void> { /* Web never writes audio. */ }
