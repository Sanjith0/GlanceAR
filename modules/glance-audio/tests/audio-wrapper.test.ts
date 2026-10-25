import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAudioCapture,
  createAudioLeaseTicket,
  isAudioCaptureAvailable,
  prepareAudioCapture,
  renewAudioLease,
  startAudioCapture,
  stopAudioCapture,
  subscribeAudioStopped,
} from '../../../src/capture/audio.native';

const { native, platform, remove } = vi.hoisted(() => {
  const remove = vi.fn();
  return {
    remove,
    platform: { OS: 'ios' },
    native: {
      prepare: vi.fn(),
      createLeaseTicket: vi.fn(),
      start: vi.fn(),
      renew: vi.fn(),
      stop: vi.fn(),
      delete: vi.fn(),
      addListener: vi.fn(() => ({ remove })),
    },
  };
});
vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('../src/GlanceAudioModule', () => ({ default: native }));

describe('native audio boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.OS = 'ios';
  });

  it('preparation only prepares; it cannot implicitly start capture', async () => {
    await prepareAudioCapture('capture-a');
    expect(native.prepare).toHaveBeenCalledWith('capture-a');
    expect(native.start).not.toHaveBeenCalled();
  });

  it('forwards ticket, capture ID and raw server duration unchanged', async () => {
    native.createLeaseTicket.mockResolvedValueOnce('native-ticket');
    await expect(createAudioLeaseTicket()).resolves.toBe('native-ticket');
    await startAudioCapture(5_000, 'native-ticket', 'capture-a');
    await renewAudioLease(4_321, 'renew-ticket', 'capture-a');
    expect(native.start).toHaveBeenCalledWith(5_000, 'native-ticket', 'capture-a');
    expect(native.renew).toHaveBeenCalledWith(4_321, 'renew-ticket', 'capture-a');
  });

  it('does not hide native expiry or permission failures', async () => {
    native.renew.mockRejectedValueOnce(new Error('expired'));
    await expect(renewAudioLease(5_000, 'old-ticket', 'capture-a')).rejects.toThrow('expired');
  });

  it('returns native finalized URI and forwards owned deletion', async () => {
    const output = { uri: 'file:///owned/capture.wav', mimeType: 'audio/wav' };
    native.stop.mockResolvedValueOnce(output);
    await expect(stopAudioCapture('capture-a')).resolves.toEqual(output);
    expect(native.stop).toHaveBeenCalledWith('capture-a');
    await deleteAudioCapture(output.uri);
    expect(native.delete).toHaveBeenCalledWith(output.uri);
  });

  it('subscribes and removes the native stopped listener', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAudioStopped(listener);
    expect(native.addListener).toHaveBeenCalledWith('onAudioStopped', listener);
    unsubscribe();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('fails closed outside iOS, with cleanup remaining safe', async () => {
    platform.OS = 'android';
    expect(isAudioCaptureAvailable()).toBe(false);
    await expect(prepareAudioCapture('capture-a')).rejects.toThrow('iPhone development build');
    await expect(startAudioCapture(1_000, 'ticket', 'capture-a')).rejects.toThrow('iPhone development build');
    await expect(stopAudioCapture('capture-a')).resolves.toEqual({ uri: null, mimeType: 'audio/wav' });
    expect(native.start).not.toHaveBeenCalled();
    expect(native.stop).not.toHaveBeenCalled();
  });
});
