import { afterEach, describe, expect, it, vi } from 'vitest';
import { openMicrophone, phoneMicrophone } from '../src/capture/browserAudio';

type Device = { kind: MediaDeviceKind; label: string; deviceId: string };
const iphone: Device = { kind: 'audioinput', label: 'iPhone Microphone', deviceId: 'own' };
const glasses: Device = { kind: 'audioinput', label: 'Meta Adventurer 4821', deviceId: 'bt' };
const camera: Device = { kind: 'videoinput', label: 'iPhone Camera', deviceId: 'cam' };

/** A stand-in for navigator.mediaDevices that records each request. */
function media(options: { before: Device[]; after?: Device[]; defaultDevice?: string; refuse?: string[] }) {
  const requests: (string | 'default')[] = [];
  const stopped: string[] = [];
  let opened = false;
  const stream = (deviceId: string) => {
    const track = { stop: () => stopped.push(deviceId), getSettings: () => ({ deviceId }) };
    return { getTracks: () => [track], getAudioTracks: () => [track], deviceId };
  };
  vi.stubGlobal('navigator', { mediaDevices: {
    enumerateDevices: async () => (opened ? options.after ?? options.before : options.before),
    getUserMedia: async (constraints: { audio: { deviceId?: { exact: string } } }) => {
      const wanted = constraints.audio.deviceId?.exact;
      requests.push(wanted ?? 'default');
      if (wanted && options.refuse?.includes(wanted)) throw new DOMException('gone', 'OverconstrainedError');
      opened = true;
      return stream(wanted ?? options.defaultDevice ?? 'bt');
    },
  } });
  return { requests, stopped };
}
const opened = async () => (await openMicrophone({ channelCount: 1 }) as unknown as { deviceId: string }).deviceId;
afterEach(() => { vi.unstubAllGlobals(); });

describe('choosing the microphone', () => {
  it('finds the phone’s own microphone by label and ignores everything else', () => {
    expect(phoneMicrophone([glasses, camera, iphone])).toBe('own');
    expect(phoneMicrophone([{ ...iphone, label: 'iPad Microphone' }])).toBe('own');
    expect(phoneMicrophone([glasses, camera])).toBeNull();
    expect(phoneMicrophone([{ kind: 'audioinput', label: '', deviceId: '' }])).toBeNull();
    expect(phoneMicrophone([{ kind: 'videoinput', label: 'iPhone Microphone', deviceId: 'x' }])).toBeNull();
    expect(phoneMicrophone([{ kind: 'audioinput', label: 'MacBook Pro Microphone', deviceId: 'mac' }])).toBeNull();
  });

  it('asks for the phone’s microphone straight away when its label is already visible', async () => {
    const m = media({ before: [glasses, iphone] });
    expect(await opened()).toBe('own');
    expect(m.requests).toEqual(['own']); // the headset is never opened, not even briefly
  });

  it('on first use opens the default, then switches off a headset once labels appear', async () => {
    const hidden: Device[] = [{ kind: 'audioinput', label: '', deviceId: '' }];
    const m = media({ before: hidden, after: [glasses, iphone], defaultDevice: 'bt' });
    expect(await opened()).toBe('own');
    expect(m.requests).toEqual(['default', 'own']);
    expect(m.stopped).toEqual(['bt']);
  });

  it('keeps the default when it already is the phone’s microphone', async () => {
    const hidden: Device[] = [{ kind: 'audioinput', label: '', deviceId: '' }];
    const m = media({ before: hidden, after: [iphone], defaultDevice: 'own' });
    expect(await opened()).toBe('own');
    expect(m.requests).toEqual(['default']);
    expect(m.stopped).toEqual([]);
  });

  it('uses the default microphone when there is no phone microphone to choose (a laptop)', async () => {
    const m = media({ before: [{ kind: 'audioinput', label: 'MacBook Pro Microphone', deviceId: 'mac' }], defaultDevice: 'mac' });
    expect(await opened()).toBe('mac');
    expect(m.requests).toEqual(['default']);
  });

  it('falls back to the default if the phone’s microphone cannot be opened', async () => {
    const m = media({ before: [glasses, iphone], refuse: ['own'], defaultDevice: 'bt' });
    expect(await opened()).toBe('bt');
    expect(m.requests).toEqual(['own', 'default']);
    expect(m.stopped).toEqual([]);
  });
});
