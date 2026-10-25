import { NativeModule, requireOptionalNativeModule } from 'expo';

export type AudioStoppedEvent = { reason: string; uri: string | null; captureID: string };
export type AudioCaptureResult = { uri: string | null; mimeType: 'audio/wav' };

type GlanceAudioEvents = {
  onAudioStopped(event: AudioStoppedEvent): void;
};

declare class GlanceAudioModule extends NativeModule<GlanceAudioEvents> {
  prepare(captureID: string): Promise<void>;
  createLeaseTicket(): Promise<string>;
  start(remainingMs: number, ticket: string, captureID: string): Promise<void>;
  renew(remainingMs: number, ticket: string, captureID: string): Promise<void>;
  stop(captureID: string): Promise<AudioCaptureResult>;
  delete(uri: string): Promise<void>;
}

export default requireOptionalNativeModule<GlanceAudioModule>('GlanceAudio');
