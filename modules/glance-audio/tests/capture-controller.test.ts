import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureController, serverLeaseDuration, type CaptureContext } from '../src/CaptureController';
import type { Conversation, GlanceDataClient, RecordingLease } from '../../../src/domain';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const lease = { leaseUntil: 15_000, serverNow: 10_000 };
const empty = { uri: null, mimeType: 'audio/wav' as const };
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const controllers: CaptureController[] = [];
function conversation(id = 'conversation-a'): Conversation {
  return {
    id, eventId: 'event', recorderId: 'me', status: 'consent',
    participants: [{ id: 'me', name: 'Me', role: '', photoUrl: '' }, { id: 'peer', name: 'Peer', role: '', photoUrl: '' }],
    recordingConsent: ['me', 'peer'], exchangeConsent: [],
  };
}
function make(id = 'conversation-a', meId = 'me') {
  const audio = {
    available: vi.fn(() => true), prepare: vi.fn(async (_id: string) => {}),
    ticket: vi.fn(async () => 'native-ticket'),
    start: vi.fn(async (_ms: number, _ticket: string, _id: string) => {}),
    renew: vi.fn(async (_ms: number, _ticket: string, _id: string) => {}),
    stop: vi.fn(async (_id: string): Promise<{ uri: string | null; mimeType: 'audio/wav' }> => empty),
    delete: vi.fn(async (_uri: string) => {}),
  };
  const client = {
    heartbeat: vi.fn(async (_token: string, _id: string, _consenting?: () => boolean): Promise<RecordingLease | null> => lease),
    startRecording: vi.fn(async (_token: string, _id: string) => lease),
    stop: vi.fn(async (_token: string, _id: string): Promise<{ connectedAt: number | null }> => ({ connectedAt: null })),
    finishConnection: vi.fn(async (_token: string, _id: string, _method: 'gesture' | 'button') => {}),
    abandonAudio: vi.fn(async (_token: string, _id: string) => {}),
    cancel: vi.fn(async (_token: string, _id: string) => {}),
    createUploadUrl: vi.fn(async (_token: string, _id: string) => 'https://upload.invalid'),
    attachAudio: vi.fn(async (_token: string, _id: string, _storage: string, _mime: string) => {}),
  };
  const upload = vi.fn(async (_url: string, _uri: string, _signal?: AbortSignal) => 'storage-a');
  const onView = vi.fn();
  const controller = new CaptureController({ audio, upload, onView });
  controllers.push(controller);
  const context: CaptureContext = { conversation: conversation(id), client: client as unknown as GlanceDataClient, token: 'token', meId };
  controller.mount(); controller.configure(context); controller.setFocused(true);
  return { controller, context, audio, client, upload, onView };
}
afterEach(async () => {
  for (const controller of controllers.splice(0)) { await controller.cancel(); controller.unmount(); }
  await flush();
  vi.useRealTimers();
});

describe('capture lifecycle safety', () => {
  it('refuses permission preparation until both people consent', async () => {
    const h = make();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), recordingConsent: ['me'] } });
    await h.controller.start();
    expect(h.audio.prepare).not.toHaveBeenCalled();
  });

  it('only structured start NOT_READY preserves consent for a fresh scoped retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const h = make();
    h.client.startRecording.mockRejectedValueOnce({ data: { code: 'NOT_READY', message: 'Both phones must be online.' } });
    await h.controller.start();
    expect(h.client.cancel).not.toHaveBeenCalled();
    expect(h.audio.start).not.toHaveBeenCalled();
    expect(h.audio.stop).toHaveBeenCalledOnce();
    expect(h.onView.mock.lastCall?.[0].autoStartRetryable).toBe(true);
    const retry = h.controller.start(); await flush();
    expect(h.onView.mock.lastCall?.[0].autoStartRetryable).toBe(false);
    await vi.advanceTimersByTimeAsync(550); await retry;
    expect(h.audio.start).toHaveBeenCalledOnce();
    expect(h.audio.prepare.mock.calls[0][0]).not.toBe(h.audio.prepare.mock.calls[1][0]);
    expect(h.client.cancel).not.toHaveBeenCalled();
  });

  it.each([
    new Error('NOT_READY transport text is not a structured code'),
    { data: 'NOT_READY' },
    { data: { code: 'PERMISSION_DENIED' } },
  ])('unknown/non-readiness start failures remain terminal and never auto-retry', async error => {
    const h = make();
    h.client.startRecording.mockRejectedValueOnce(error);
    await h.controller.start();
    expect(h.onView.mock.lastCall?.[0].autoStartRetryable).toBe(false);
    expect(h.client.cancel).toHaveBeenCalled();
  });

  it('a structured NOT_READY from permission preparation is not retryable', async () => {
    const h = make();
    h.audio.prepare.mockRejectedValueOnce({ data: { code: 'NOT_READY' } });
    await h.controller.start();
    expect(h.onView.mock.lastCall?.[0].autoStartRetryable).toBe(false);
    expect(h.client.cancel).toHaveBeenCalled();
  });

  it('has a synchronous double-tap and global owner guard across mounted routes', async () => {
    const a = make(), b = make('conversation-b');
    const permission = deferred<void>(); a.audio.prepare.mockReturnValueOnce(permission.promise);
    const start = a.controller.start();
    await a.controller.start(); await b.controller.start();
    expect(a.audio.prepare).toHaveBeenCalledTimes(1);
    expect(b.audio.prepare).not.toHaveBeenCalled();
    permission.resolve(); await start;
    expect(a.audio.start).toHaveBeenCalledTimes(1);
  });

  it('cancel during delayed prepare never requests backend start or starts the mic', async () => {
    const h = make(); const permission = deferred<void>();
    h.audio.prepare.mockReturnValueOnce(permission.promise);
    const start = h.controller.start();
    await h.controller.cancel();
    permission.resolve(); await start;
    expect(h.client.startRecording).not.toHaveBeenCalled();
    expect(h.audio.start).not.toHaveBeenCalled();
    expect(h.audio.stop).toHaveBeenCalledWith(h.audio.prepare.mock.calls[0][0]);
  });

  it('serializes Start behind an in-flight consent presence handshake', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const h = make();
    const firstACK = deferred<RecordingLease | null>();
    h.client.heartbeat.mockReturnValueOnce(firstACK.promise);
    const heartbeat = h.controller.heartbeat(); await flush();
    const start = h.controller.start(); await flush();
    expect(h.client.heartbeat).toHaveBeenCalledTimes(1);
    expect(h.client.startRecording).not.toHaveBeenCalled();
    firstACK.resolve(null);
    await flush();
    expect(h.client.heartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(550);
    await heartbeat; await start;
    expect(h.client.heartbeat).toHaveBeenCalledTimes(2);
    expect(h.audio.start).toHaveBeenCalledOnce();
    expect(h.client.cancel).not.toHaveBeenCalled();
  });

  it('delays an interval immediately after Start so throttled null does not stop new capture', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const h = make();
    let previousACK = -Infinity;
    h.client.heartbeat.mockImplementation(async () => {
      const now = performance.now();
      if (now - previousACK < 500) return null;
      previousACK = now;
      return lease;
    });
    await h.controller.start();
    const heartbeat = h.controller.heartbeat();
    await flush();
    expect(h.client.heartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(h.client.heartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(51);
    await heartbeat;
    expect(h.client.heartbeat).toHaveBeenCalledTimes(2);
    expect(h.audio.renew).toHaveBeenCalledOnce();
    expect(h.audio.stop).not.toHaveBeenCalled();
    expect(h.onView.mock.lastCall?.[0].capturing).toBe(true);
  });

  it('a cadence-delayed interval never requests a ticket ACK or renews after Stop', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const h = make(); await h.controller.start();
    const heartbeat = h.controller.heartbeat(); await flush();
    await vi.advanceTimersByTimeAsync(250);
    await h.controller.stop();
    await vi.advanceTimersByTimeAsync(300);
    await heartbeat;
    expect(h.client.heartbeat).toHaveBeenCalledTimes(1);
    expect(h.audio.renew).not.toHaveBeenCalled();
    expect(h.onView.mock.lastCall?.[0].capturing).toBe(false);
  });

  it('cadence uses monotonic time even when the wall clock jumps forward', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const h = make(); await h.controller.start();
    vi.setSystemTime(Date.now() + 60_000);
    const heartbeat = h.controller.heartbeat(); await flush();
    expect(h.client.heartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(550);
    await heartbeat;
    expect(h.client.heartbeat).toHaveBeenCalledTimes(2);
  });

  it.each(['cancel', 'unmount', 'blur', 'switch'] as const)('late server start after %s cannot start audio', async action => {
    const h = make(); const backend = deferred<RecordingLease>();
    h.client.startRecording.mockReturnValueOnce(backend.promise);
    const start = h.controller.start(); await flush();
    expect(h.client.startRecording).toHaveBeenCalledOnce();
    if (action === 'cancel') await h.controller.cancel();
    if (action === 'unmount') h.controller.unmount();
    if (action === 'blur') h.controller.setFocused(false);
    if (action === 'switch') h.controller.configure({ ...h.context, conversation: conversation('conversation-b') });
    backend.resolve(lease); await start;
    expect(h.audio.start).not.toHaveBeenCalled();
    expect(h.client.cancel).toHaveBeenCalledWith('token', 'conversation-a');
    expect(h.onView.mock.calls.some(([view]) => view.capturing)).toBe(false);
  });

  it('late native completion after cancellation never restores capturing UI', async () => {
    const h = make(); const nativeStart = deferred<void>();
    h.audio.start.mockReturnValueOnce(nativeStart.promise);
    const start = h.controller.start(); await flush();
    expect(h.audio.start).toHaveBeenCalledOnce();
    await h.controller.cancel(); nativeStart.resolve(); await start;
    expect(h.onView.mock.calls.some(([view]) => view.capturing)).toBe(false);
  });

  it('native stop before start completion cannot produce optimistic capture state', async () => {
    const h = make(); const nativeStart = deferred<void>();
    h.audio.start.mockReturnValueOnce(nativeStart.promise);
    const start = h.controller.start(); await flush();
    h.controller.onStopped({ captureID: h.audio.prepare.mock.calls[0][0], uri: null, reason: 'lease-expired' });
    nativeStart.resolve(); await start; await flush();
    expect(h.onView.mock.calls.some(([view]) => view.capturing)).toBe(false);
  });

  it('mints native ticket before network start and passes raw duration without double RTT subtraction', async () => {
    const h = make(); await h.controller.start();
    expect(h.audio.ticket.mock.invocationCallOrder[0]).toBeLessThan(h.client.startRecording.mock.invocationCallOrder[0]);
    expect(h.audio.start).toHaveBeenCalledWith(5_000, 'native-ticket', h.audio.prepare.mock.calls[0][0]);
    expect(serverLeaseDuration({ serverNow: 5, leaseUntil: Infinity })).toBe(0);
    expect(serverLeaseDuration({ serverNow: 0, leaseUntil: 20_000 })).toBe(5_000);
  });

  it('stale heartbeat after stop/new capture cannot renew either capture', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const a = make(); await a.controller.start();
    const network = deferred<RecordingLease | null>();
    a.client.heartbeat.mockReturnValueOnce(network.promise);
    const heartbeat = a.controller.heartbeat(); await flush();
    await vi.advanceTimersByTimeAsync(550);
    await a.controller.stop();
    const b = make('conversation-b'); await b.controller.start();
    network.resolve(lease); await heartbeat;
    expect(a.audio.renew).not.toHaveBeenCalled();
    expect(b.audio.renew).not.toHaveBeenCalled();
  });

  it('recipient stop withdraws the in-flight ACK callback before server stop completes', async () => {
    const h = make('conversation-a', 'peer');
    const network = deferred<RecordingLease | null>(), stop = deferred<{ connectedAt: number | null }>();
    h.client.heartbeat.mockReturnValueOnce(network.promise);
    h.client.stop.mockReturnValueOnce(stop.promise);
    const heartbeat = h.controller.heartbeat(); await flush();
    const consent = h.client.heartbeat.mock.calls[0][2]!;
    expect(consent()).toBe(true);
    const stopping = h.controller.stop();
    expect(consent()).toBe(false);
    network.resolve(lease); stop.resolve({ connectedAt: null }); await heartbeat; await stopping;
    await h.controller.heartbeat();
    expect(h.client.heartbeat).toHaveBeenCalledOnce();
  });

  it('cancellation while upload URL is pending prevents HTTP upload and attach', async () => {
    const h = make(); await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///capture-a.wav', mimeType: 'audio/wav' });
    const url = deferred<string>(); h.client.createUploadUrl.mockReturnValueOnce(url.promise);
    const stopping = h.controller.stop(); await flush();
    await h.controller.cancel(); url.resolve('https://upload.invalid'); await stopping;
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.client.attachAudio).not.toHaveBeenCalled();
    expect(h.audio.delete).toHaveBeenCalledWith('file:///capture-a.wav');
  });

  it('in-flight HTTP upload is aborted and its late result is never attached after cancel', async () => {
    const h = make(); await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///capture-a.wav', mimeType: 'audio/wav' });
    const upload = deferred<string>(); h.upload.mockReturnValueOnce(upload.promise);
    const stopping = h.controller.stop(); await flush();
    const signal = h.upload.mock.calls[0][2]!;
    await h.controller.cancel();
    expect(signal.aborted).toBe(true);
    upload.resolve('late-storage'); await stopping;
    expect(h.client.attachAudio).not.toHaveBeenCalled();
  });

  it('double stop and retry calls cannot duplicate upload', async () => {
    const h = make(); await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///capture-a.wav', mimeType: 'audio/wav' });
    const upload = deferred<string>(); h.upload.mockReturnValueOnce(upload.promise);
    const first = h.controller.stop(); const second = h.controller.stop();
    await flush(); await h.controller.retryUpload();
    expect(h.upload).toHaveBeenCalledOnce();
    upload.resolve('storage'); await first; await second;
    expect(h.client.attachAudio).toHaveBeenCalledOnce();
  });

  it('retention expiry aborts upload and refuses late attachment', async () => {
    vi.useFakeTimers();
    const h = make(); await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///capture-a.wav', mimeType: 'audio/wav' });
    const upload = deferred<string>(); h.upload.mockReturnValueOnce(upload.promise);
    const stopping = h.controller.stop(); await flush();
    const signal = h.upload.mock.calls[0][2]!;
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(signal.aborted).toBe(true);
    upload.resolve('too-late'); await stopping;
    expect(h.client.attachAudio).not.toHaveBeenCalled();
    expect(h.audio.delete).toHaveBeenCalledWith('file:///capture-a.wav');
  });

  it('retains pending identity after local deletion failure and retry does not re-upload', async () => {
    const h = make(); await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///capture-a.wav', mimeType: 'audio/wav' });
    h.audio.delete.mockRejectedValueOnce(new Error('protected-file temporarily unavailable'));
    await h.controller.stop();
    expect(h.onView.mock.lastCall?.[0].hasUpload).toBe(true);
    await h.controller.retryUpload();
    expect(h.upload).toHaveBeenCalledOnce();
    expect(h.onView.mock.lastCall?.[0].hasUpload).toBe(false);
  });

  it.each(['blur', 'unmount', 'switch'] as const)('preserves an uploaded/shared recap on automatic %s', async action => {
    const h = make(); await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///capture-a.wav', mimeType: 'audio/wav' });
    await h.controller.stop();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), status: 'shared' } });
    if (action === 'blur') h.controller.setFocused(false);
    if (action === 'unmount') h.controller.unmount();
    if (action === 'switch') h.controller.configure({ ...h.context, conversation: conversation('conversation-b') });
    await flush();
    expect(h.client.cancel).not.toHaveBeenCalled();
    expect(h.client.attachAudio).toHaveBeenCalledOnce();
  });

  it('preserves uploaded audio awaiting the other exchange approval on blur', async () => {
    const h = make(); await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///capture-a.wav', mimeType: 'audio/wav' });
    await h.controller.stop();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), status: 'ended', exchangeConsent: ['me'] } });
    h.controller.setFocused(false); await flush();
    expect(h.client.cancel).not.toHaveBeenCalled();
    expect(h.client.attachAudio).toHaveBeenCalledOnce();
  });

  it.each([['gesture', 'gesture'], ['finish_button', 'button']] as const)(
    'event %s closes native audio before finishConnection(%s), then uploads',
    async (reason, method) => {
      const h = make();
      h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
      await h.controller.start();
      const closed = deferred<{ uri: string | null; mimeType: 'audio/wav' }>();
      h.audio.stop.mockReturnValueOnce(closed.promise);
      const finish = h.controller.stop(reason);
      await flush();
      expect(h.client.finishConnection).not.toHaveBeenCalled();
      expect(h.client.stop).not.toHaveBeenCalled();
      closed.resolve({ uri: 'file:///event.wav', mimeType: 'audio/wav' });
      await finish;
      expect(h.client.finishConnection).toHaveBeenCalledWith('token', 'conversation-a', method);
      expect(h.client.finishConnection.mock.invocationCallOrder[0]).toBeLessThan(h.upload.mock.invocationCallOrder[0]);
      expect(h.client.attachAudio).toHaveBeenCalledOnce();
      expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(true);
    },
  );

  it.each(['Stopped', 'background', 'interruption', 'lease-expired', 'Three-finger signal detected'])(
    'event ordinary %s never connects or uploads unapproved raw audio', async reason => {
      const h = make();
      h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
      await h.controller.start();
      h.audio.stop.mockResolvedValue({ uri: 'file:///unshared.wav', mimeType: 'audio/wav' });
      await h.controller.stop(reason);
      expect(h.client.finishConnection).not.toHaveBeenCalled();
      expect(h.client.createUploadUrl).not.toHaveBeenCalled();
      expect(h.audio.delete).toHaveBeenCalledWith('file:///unshared.wav');
    },
  );

  it('legacy gesture remains ordinary stop and never bypasses two-confirm exchange', async () => {
    const h = make(); await h.controller.start();
    await h.controller.stop('gesture');
    expect(h.client.stop).toHaveBeenCalledOnce();
    expect(h.client.finishConnection).not.toHaveBeenCalled();
  });

  it('cancel before native close completes prevents event finish', async () => {
    const h = make();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
    await h.controller.start();
    const closed = deferred<{ uri: string | null; mimeType: 'audio/wav' }>();
    h.audio.stop.mockReturnValueOnce(closed.promise);
    const finish = h.controller.stop('gesture');
    await h.controller.cancel();
    closed.resolve({ uri: 'file:///cancelled.wav', mimeType: 'audio/wav' }); await finish;
    expect(h.client.finishConnection).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('event finish retry repeats only the original explicit intent and never inserts stop', async () => {
    const h = make();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
    await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///event.wav', mimeType: 'audio/wav' });
    h.client.finishConnection.mockRejectedValueOnce(new Error('Network response lost'));
    await h.controller.stop('finish_button');
    expect(h.upload).not.toHaveBeenCalled();
    await h.controller.retryUpload();
    expect(h.client.finishConnection).toHaveBeenCalledTimes(2);
    expect(h.client.finishConnection.mock.calls.every(call => call[2] === 'button')).toBe(true);
    expect(h.client.stop).not.toHaveBeenCalled();
    expect(h.client.attachAudio).toHaveBeenCalledOnce();
  });

  it('connectedAt alone is not navigation safe until local audio attachment succeeds', async () => {
    const h = make();
    const eventConversation = { ...conversation(), consentMode: 'event' as const };
    h.controller.configure({ ...h.context, conversation: eventConversation });
    await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///event.wav', mimeType: 'audio/wav' });
    const upload = deferred<string>(); h.upload.mockReturnValueOnce(upload.promise);
    const finish = h.controller.stop('gesture'); await flush();
    h.controller.configure({ ...h.context, conversation: { ...eventConversation, status: 'ended', connectedAt: Date.now() } });
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(false);
    upload.resolve('storage'); await finish;
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(true);
  });

  it('forced blur during connected upload preserves connection and abandons only raw audio', async () => {
    const h = make();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
    await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///event.wav', mimeType: 'audio/wav' });
    const upload = deferred<string>(); h.upload.mockReturnValueOnce(upload.promise);
    const finish = h.controller.stop('gesture'); await flush();
    h.controller.setFocused(false);
    expect(h.upload.mock.calls[0][2]?.aborted).toBe(true);
    upload.resolve('stale-storage'); await finish; await flush();
    expect(h.client.cancel).not.toHaveBeenCalled();
    expect(h.client.abandonAudio).toHaveBeenCalledWith('token', 'conversation-a');
    expect(h.client.attachAudio).not.toHaveBeenCalled();
  });

  it('explicit local discard preserves event connection and prevents late attachment', async () => {
    const h = make();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
    await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///event.wav', mimeType: 'audio/wav' });
    const upload = deferred<string>(); h.upload.mockReturnValueOnce(upload.promise);
    const finish = h.controller.stop('gesture'); await flush();
    await h.controller.discardLocal();
    upload.resolve('discarded-storage'); await finish;
    expect(h.client.cancel).not.toHaveBeenCalled();
    expect(h.client.abandonAudio).toHaveBeenCalled();
    expect(h.client.attachAudio).not.toHaveBeenCalled();
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(true);
  });

  it('peer-confirmed event connection closes recorder and uploads without a second finish', async () => {
    const h = make();
    const eventConversation = { ...conversation(), consentMode: 'event' as const };
    h.controller.configure({ ...h.context, conversation: eventConversation });
    await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///peer-finished.wav', mimeType: 'audio/wav' });
    h.controller.configure({ ...h.context, conversation: { ...eventConversation, status: 'ended', connectedAt: Date.now() } });
    await flush();
    expect(h.audio.stop).toHaveBeenCalledOnce();
    expect(h.client.finishConnection).not.toHaveBeenCalled();
    expect(h.client.attachAudio).toHaveBeenCalledOnce();
  });

  it.each(['blur', 'unmount'] as const)('preserves uncertain finish commit when %s precedes server ACK/snapshot', async action => {
    const h = make();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
    await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///event.wav', mimeType: 'audio/wav' });
    const finishACK = deferred<void>(); h.client.finishConnection.mockReturnValueOnce(finishACK.promise);
    const finish = h.controller.stop('gesture'); await flush();
    expect(h.client.finishConnection).toHaveBeenCalledOnce();
    if (action === 'blur') h.controller.setFocused(false);
    else h.controller.unmount();
    finishACK.resolve(); await finish;
    expect(h.client.cancel).not.toHaveBeenCalled();
    expect(h.client.abandonAudio).toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('uncertain failed finish response cannot trigger destructive automatic cancellation', async () => {
    const h = make();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
    await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///event.wav', mimeType: 'audio/wav' });
    h.client.finishConnection.mockRejectedValueOnce(new Error('Commit response lost'));
    await h.controller.stop('gesture');
    h.controller.setFocused(false); await flush();
    expect(h.client.cancel).not.toHaveBeenCalled();
    expect(h.client.abandonAudio).toHaveBeenCalled();
  });

  it('a connected finish without valid audio marks recap unavailable without removing chat', async () => {
    const h = make();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
    await h.controller.start();
    await h.controller.stop('finish_button');
    expect(h.client.finishConnection).toHaveBeenCalledOnce();
    expect(h.client.abandonAudio).toHaveBeenCalledOnce();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.client.cancel).not.toHaveBeenCalled();
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(true);
  });

  it('disabled adapter context cannot start, heartbeat, or cancel a harness-owned conversation', async () => {
    const h = make();
    h.controller.configure({ ...h.context, client: null });
    h.controller.setFocused(false);
    await h.controller.start(); await h.controller.heartbeat(); await h.controller.stop(); await h.controller.cancel();
    h.controller.setAppActive(false);
    expect(h.audio.prepare).not.toHaveBeenCalled();
    expect(h.audio.start).not.toHaveBeenCalled();
    expect(h.client.heartbeat).not.toHaveBeenCalled();
    expect(h.client.cancel).not.toHaveBeenCalled();
  });

  it('authoritative peer finish uploads despite a stale unconnected React snapshot', async () => {
    const h = make();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
    await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///peer-finished.wav', mimeType: 'audio/wav' });
    // Peer finish committed, but the local rendered conversation still has no connectedAt.
    h.client.stop.mockResolvedValueOnce({ connectedAt: Date.now() });
    await h.controller.stop('Consent lease ended');
    expect(h.client.finishConnection).not.toHaveBeenCalled();
    expect(h.client.attachAudio).toHaveBeenCalledOnce();
    expect(h.client.abandonAudio).not.toHaveBeenCalled();
    expect(h.audio.delete.mock.invocationCallOrder[0]).toBeGreaterThan(h.client.attachAudio.mock.invocationCallOrder[0]);
  });

  it('unknown stop outcome retains raw locally without sharing until authoritative retry', async () => {
    const h = make();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
    await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///unknown.wav', mimeType: 'audio/wav' });
    h.client.stop.mockResolvedValueOnce(undefined as unknown as { connectedAt: number | null });
    await h.controller.stop('Stopped');
    expect(h.audio.delete).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(false);
    h.client.stop.mockResolvedValueOnce({ connectedAt: Date.now() });
    await h.controller.retryUpload();
    expect(h.client.finishConnection).not.toHaveBeenCalled();
    expect(h.client.attachAudio).toHaveBeenCalledOnce();
  });

  it('automatic blur during uncertain peer-finish/stop outcome never cancels the connection', async () => {
    const h = make();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
    await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///peer-finished.wav', mimeType: 'audio/wav' });
    const stopped = deferred<{ connectedAt: number | null }>();
    h.client.stop.mockReturnValueOnce(stopped.promise);
    const stopping = h.controller.stop('Consent lease ended'); await flush();
    h.controller.setFocused(false);
    expect(h.client.cancel).not.toHaveBeenCalled();
    stopped.resolve({ connectedAt: Date.now() }); await stopping;
    expect(h.client.cancel).not.toHaveBeenCalled();
    expect(h.client.abandonAudio).toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it.each(['native-first', 'server-first'] as const)(
    'detached peer-finish receipt settles recap even with deferred native stop (%s)', async order => {
      const h = make();
      h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
      await h.controller.start();
      const closed = deferred<{ uri: string | null; mimeType: 'audio/wav' }>();
      const stopped = deferred<{ connectedAt: number | null }>();
      h.audio.stop.mockReturnValueOnce(closed.promise);
      h.client.stop.mockReturnValueOnce(stopped.promise);
      const stopping = h.controller.stop('Consent lease ended');
      h.controller.setFocused(false);
      if (order === 'native-first') {
        closed.resolve({ uri: 'file:///late.wav', mimeType: 'audio/wav' });
        await flush();
        stopped.resolve({ connectedAt: Date.now() });
      } else {
        stopped.resolve({ connectedAt: Date.now() });
        await flush();
        closed.resolve({ uri: 'file:///late.wav', mimeType: 'audio/wav' });
      }
      await stopping; await flush();
      expect(h.client.cancel).not.toHaveBeenCalled();
      expect(h.client.abandonAudio).toHaveBeenCalledWith('token', 'conversation-a');
      expect(h.audio.delete).toHaveBeenCalledWith('file:///late.wav');
      expect(h.upload).not.toHaveBeenCalled();
    },
  );

  it.each(['preparing', 'starting-native', 'recording'] as const)(
    'confirmed navigation discard awaits native stop in %s phase', async phase => {
      const h = make();
      const preparation = deferred<void>(), nativeStart = deferred<void>();
      if (phase === 'preparing') h.audio.prepare.mockReturnValueOnce(preparation.promise);
      if (phase === 'starting-native') h.audio.start.mockReturnValueOnce(nativeStart.promise);
      const starting = h.controller.start(); await flush();
      if (phase === 'recording') await starting;
      const closed = deferred<{ uri: string | null; mimeType: 'audio/wav' }>();
      h.audio.stop.mockReturnValueOnce(closed.promise);
      let resolved = false;
      const discard = h.controller.discardLocal().then(() => { resolved = true; });
      await flush();
      expect(resolved).toBe(false);
      expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(false);
      expect(h.audio.stop).toHaveBeenCalledOnce();
      closed.resolve(empty); await discard;
      expect(resolved).toBe(true);
      expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(true);
      preparation.resolve(); nativeStart.resolve(); await starting;
      expect(h.onView.mock.lastCall?.[0].capturing).toBe(false);
    },
  );

  it('navigation discard rejects an unacknowledged stop and retries the same native scope', async () => {
    const h = make(); await h.controller.start();
    h.audio.stop.mockRejectedValueOnce(new Error('Native close was not acknowledged'));
    await expect(h.controller.discardLocal()).rejects.toThrow('not acknowledged');
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(false);
    const captureID = h.audio.prepare.mock.calls[0][0];
    await h.controller.discardLocal();
    expect(h.audio.stop.mock.calls).toEqual([[captureID], [captureID]]);
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(true);
    expect(h.audio.start).toHaveBeenCalledOnce();
  });

  it('navigation discard rejects failed local deletion and retains the retry handle', async () => {
    const h = make(); await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///protected.wav', mimeType: 'audio/wav' });
    h.audio.delete.mockRejectedValue(new Error('Local file is protected'));
    await expect(h.controller.discardLocal()).rejects.toThrow('protected');
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(false);
    h.audio.delete.mockResolvedValue();
    await h.controller.discardLocal();
    expect(h.audio.stop).toHaveBeenCalledOnce();
    expect(h.audio.delete).toHaveBeenCalledWith('file:///protected.wav');
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(true);
  });

  it('navigation discard after server deletion still awaits the detached native stop', async () => {
    const h = make(); await h.controller.start();
    const closed = deferred<{ uri: string | null; mimeType: 'audio/wav' }>();
    h.audio.stop.mockReturnValueOnce(closed.promise);
    h.controller.configure({ ...h.context, conversation: undefined });
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(false);
    let resolved = false;
    const discard = h.controller.discardLocal().then(() => { resolved = true; });
    await flush();
    expect(resolved).toBe(false);
    closed.resolve(empty); await discard;
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(true);
  });

  it('navigation discard preserves a submitted finish while waiting for local deletion', async () => {
    const h = make();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
    await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///connection.wav', mimeType: 'audio/wav' });
    const finishACK = deferred<void>(); h.client.finishConnection.mockReturnValueOnce(finishACK.promise);
    const finish = h.controller.stop('gesture'); await flush();
    const deleted = deferred<void>(); h.audio.delete.mockReturnValue(deleted.promise);
    let resolved = false;
    const discard = h.controller.discardLocal().then(() => { resolved = true; });
    await flush();
    expect(resolved).toBe(false);
    expect(h.client.cancel).not.toHaveBeenCalled();
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(false);
    deleted.resolve(); await discard;
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(true);
    finishACK.resolve(); await finish;
    expect(h.client.cancel).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('navigation discard from active event capture preserves an unseen peer-finished connection', async () => {
    const h = make();
    h.controller.configure({ ...h.context, conversation: { ...conversation(), consentMode: 'event' } });
    await h.controller.start();
    h.audio.stop.mockResolvedValue({ uri: 'file:///peer-connected.wav', mimeType: 'audio/wav' });
    h.client.stop.mockResolvedValue({ connectedAt: Date.now() });
    await h.controller.discardLocal(); await flush();
    expect(h.client.stop).toHaveBeenCalled();
    expect(h.client.cancel).not.toHaveBeenCalled();
    expect(h.client.abandonAudio).toHaveBeenCalled();
    expect(h.onView.mock.lastCall?.[0].navigationSafe).toBe(true);
  });
});
