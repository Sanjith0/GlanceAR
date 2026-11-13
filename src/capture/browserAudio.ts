import { concatSamples, encodeWav, resample, WAV_SAMPLE_RATE } from '../audio/wav';
import { MAX_RECORDING_MS } from '../domain';

/**
 * Browser microphone capture for the same-camera demo summary. Audio stays in
 * memory until the conversation finishes, then becomes one 16 kHz mono WAV.
 * Any other ending discards it. The microphone is released on every path.
 */
const WORKLET = `class GlancePcmCapture extends AudioWorkletProcessor {
  process(inputs) { const channel = inputs[0] && inputs[0][0]; if (channel) this.port.postMessage(channel.slice(0)); return true; }
}
registerProcessor('glance-pcm-capture', GlancePcmCapture);`;

export function browserAudioSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof AudioContext !== 'undefined';
}

/** The device's own microphone, by its label ("iPhone Microphone"), if the browser lists one. */
export function phoneMicrophone(devices: readonly Pick<MediaDeviceInfo, 'kind' | 'label' | 'deviceId'>[]): string | null {
  const own = devices.find(device => device.kind === 'audioinput' && device.deviceId && /\b(iphone|ipad)\b/i.test(device.label));
  return own?.deviceId ?? null;
}

/**
 * Opens the microphone, preferring the phone's own over a headset. Smart glasses are a
 * Bluetooth headset too: left to itself iOS records through them, which captures the
 * room poorly and switches the glasses to call audio while they may be streaming video.
 * Falls back to the browser's default microphone whenever the phone's cannot be chosen.
 */
export async function openMicrophone(audio: MediaTrackConstraints): Promise<MediaStream> {
  const media = navigator.mediaDevices;
  const list = async () => { try { return await media.enumerateDevices(); } catch { return []; } };
  const exact = (deviceId: string) => media.getUserMedia({ video: false, audio: { ...audio, deviceId: { exact: deviceId } } });
  // Labels are visible once the microphone has been allowed on this page.
  const known = phoneMicrophone(await list());
  if (known) { try { return await exact(known); } catch { /* use the default below */ } }
  const stream = await media.getUserMedia({ video: false, audio });
  if (known) return stream;
  // First use: the labels only appear now, so look again and switch if a headset was picked.
  const wanted = phoneMicrophone(await list());
  if (!wanted || wanted === stream.getAudioTracks()[0]?.getSettings().deviceId) return stream;
  try {
    const own = await exact(wanted);
    stream.getTracks().forEach(track => track.stop());
    return own;
  } catch { return stream; }
}

type Session = {
  id: string; stream: MediaStream; context: AudioContext; chunks: Float32Array[]; samples: number;
  teardown: () => void;
};

export class BrowserRecorder {
  private session: Session | null = null;
  private starting: string | null = null;

  /** True while this recorder holds the microphone for `id`. */
  isRecording(id: string): boolean { return this.session?.id === id; }

  async start(id: string): Promise<void> {
    if (this.session?.id === id || this.starting === id) return;
    this.discard();
    this.starting = id;
    let stream: MediaStream | null = null, context: AudioContext | null = null;
    try {
      stream = await openMicrophone({ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      try { context = new AudioContext({ sampleRate: WAV_SAMPLE_RATE }); } catch { context = new AudioContext(); }
      // Created after the countdown, not inside a tap, so autoplay rules may start it suspended.
      if (context.state === 'suspended') await context.resume().catch(() => {});
      const source = context.createMediaStreamSource(stream);
      const chunks: Float32Array[] = [];
      const limit = context.sampleRate * MAX_RECORDING_MS / 1000;
      const session: Session = { id, stream, context, chunks, samples: 0, teardown: () => {} };
      const push = (samples: Float32Array) => {
        if (session.samples >= limit) return; // Meta accepts at most ten minutes per file.
        const kept = samples.length + session.samples > limit ? samples.slice(0, limit - session.samples) : samples;
        chunks.push(kept); session.samples += kept.length;
      };
      // Silent sink keeps the graph pulling without playing the room back through the speakers.
      const sink = context.createGain(); sink.gain.value = 0; sink.connect(context.destination);
      if (context.audioWorklet) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        const node = new AudioWorkletNode(context, 'glance-pcm-capture');
        node.port.onmessage = event => push(event.data as Float32Array);
        source.connect(node); node.connect(sink);
        session.teardown = () => { node.port.onmessage = null; source.disconnect(); node.disconnect(); };
      } else {
        const node = context.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = event => push(event.inputBuffer.getChannelData(0).slice(0));
        source.connect(node); node.connect(sink);
        session.teardown = () => { node.onaudioprocess = null; source.disconnect(); node.disconnect(); };
      }
      if (this.starting !== id) throw new Error('superseded');
      this.session = session;
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      void context?.close().catch(() => {});
      throw error;
    } finally {
      if (this.starting === id) this.starting = null;
    }
  }

  /** Ends capture for `id` and returns its WAV, or null when nothing usable was heard. */
  async stop(id: string): Promise<Blob | null> {
    const session = this.session;
    if (!session || session.id !== id) return null;
    this.release();
    const sampleRate = session.context.sampleRate;
    await session.context.close().catch(() => {});
    if (session.samples < sampleRate) return null; // Under a second is not a conversation.
    const samples = resample(concatSamples(session.chunks), sampleRate, WAV_SAMPLE_RATE);
    return new Blob([encodeWav(samples)], { type: 'audio/wav' });
  }

  /** Drops any capture (optionally only `id`) without producing audio. */
  discard(id?: string): void {
    if (id && this.starting === id) this.starting = null;
    if (!this.session || (id && this.session.id !== id)) return;
    const { context } = this.session;
    this.release();
    void context.close().catch(() => {});
  }

  private release() {
    const session = this.session;
    if (!session) return;
    this.session = null;
    session.teardown();
    session.stream.getTracks().forEach(track => track.stop());
  }
}
