/** Native builds record through the guarded GlanceAudio module, never this browser path. */
export function browserAudioSupported(): boolean { return false; }

export class BrowserRecorder {
  isRecording(_id: string): boolean { return false; }
  async start(_id: string): Promise<void> { throw new Error('Browser recording is not available in the native app.'); }
  async stop(_id: string): Promise<Blob | null> { return null; }
  discard(_id?: string): void {}
}
