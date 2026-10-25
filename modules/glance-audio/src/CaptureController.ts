import type { Conversation, GlanceDataClient, RecordingLease } from '../../../src/domain';
import { RAW_AUDIO_RETENTION_MS } from '../../../src/domain';

export type CaptureView = {
  capturing: boolean; busy: boolean; hasUpload: boolean; notice: string;
  /** Chat navigation must wait for native close and attachment, not connectedAt alone. */
  navigationSafe: boolean;
  /** Only a structured server NOT_READY at start is safe for automatic retry. */
  autoStartRetryable: boolean;
};
export const initialCaptureView: CaptureView = {
  capturing: false, busy: false, hasUpload: false, notice: '', navigationSafe: true, autoStartRetryable: false,
};
type Output = { uri: string | null; mimeType: 'audio/wav' };
export type CaptureAudio = {
  available(): boolean;
  prepare(captureID: string): Promise<void>;
  ticket(): Promise<string>;
  start(ms: number, ticket: string, captureID: string): Promise<void>;
  renew(ms: number, ticket: string, captureID: string): Promise<void>;
  stop(captureID: string): Promise<Output>;
  delete(uri: string): Promise<void>;
};
export type CaptureContext = {
  conversation: Conversation | undefined;
  client: GlanceDataClient | null;
  token: string;
  meId: string | undefined;
};
type FileRecord = { uri: string; expiresAt: number; uploaded: boolean };
type Session = {
  cid: string; captureID: string; client: GlanceDataClient; token: string;
  cancelled: boolean; phase: 'starting' | 'recording' | 'ending' | 'ended';
  abort: AbortController; file: FileRecord | null;
  eventMode: boolean; connectionFinished: boolean; connectionOutcomeKnown: boolean;
  finishSubmitted: boolean; stopSubmitted: boolean; finishMethod?: 'gesture' | 'button';
  nativeStop?: Promise<Output>; finishing?: Promise<void>; uploading?: Promise<void>;
};
type Owner = { controller: CaptureController; captureID: string };
let microphoneOwner: Owner | null = null;
let sequence = 0;
// Failed best-effort cleanup retains a retry handle until another focused controller
// can execute. Native 15-minute sweeps remain the crash/restart backstop.
const cleanupURIs = new Set<string>();
// Server presence-ticket issuance is throttled at 500 ms. Measure from completion
// (more conservative than request start) and leave a small scheduling margin.
const PRESENCE_SPACING_MS = 550;
const stale = () => new Error('Capture operation was withdrawn.');
const message = (error: unknown) => error instanceof Error ? error.message : 'Audio operation failed.';
function isNotReady(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('data' in error)) return false;
  const data = error.data;
  return typeof data === 'object' && data !== null && 'code' in data && data.code === 'NOT_READY';
}

/** No JS RTT adjustment: the one-use native ticket accounts for the entire delay. */
export function serverLeaseDuration(lease: RecordingLease): number {
  if (!Number.isFinite(lease.leaseUntil) || !Number.isFinite(lease.serverNow)) return 0;
  return Math.max(0, Math.min(5_000, lease.leaseUntil - lease.serverNow));
}

/** Pure lifecycle controller. React only supplies focus, context and view updates. */
export class CaptureController {
  private context: CaptureContext = { conversation: undefined, client: null, token: '', meId: undefined };
  private session: Session | null = null;
  private navigationStopSession: Session | null = null;
  private navigationTask: Promise<void> | null = null;
  private attached = false;
  private focused = false;
  private appActive = true;
  private withdrawn = false;
  private revision = 0;
  private heartbeatBusy = false;
  private presenceRequest: Promise<RecordingLease | null> | null = null;
  private presenceCompletedAt = -Infinity;
  private knownCaptures = new Set<string>();
  private retentionTimer: ReturnType<typeof setTimeout> | undefined;
  private view: CaptureView = { ...initialCaptureView };

  constructor(private readonly dependencies: {
    audio: CaptureAudio;
    upload(url: string, uri: string, signal?: AbortSignal): Promise<string>;
    onView(view: CaptureView): void;
    now?: () => number;
    monotonicNow?: () => number;
  }) {}

  private now() { return this.dependencies.now?.() ?? Date.now(); }
  private monotonicNow() { return this.dependencies.monotonicNow?.() ?? performance.now(); }
  private update(patch: Partial<CaptureView>) {
    this.view = { ...this.view, ...patch };
    if (this.attached && this.focused) this.dependencies.onView(this.view);
  }
  mount() { this.attached = true; }
  unmount() { this.attached = false; this.deactivate(); }
  configure(context: CaptureContext) {
    const old = this.context;
    if (old.conversation?.id !== context.conversation?.id || old.client !== context.client
      || old.token !== context.token || old.meId !== context.meId) {
      this.deactivateSession();
      this.withdrawn = false;
      this.update({ ...initialCaptureView, navigationSafe: this.navigationStopSession === null });
    }
    this.context = context;
    if (this.session && this.session.cid === context.conversation?.id && context.conversation?.connectedAt) {
      this.session.connectionFinished = true;
      this.session.connectionOutcomeKnown = true;
    }
    if (context.conversation?.status === 'cancelled') {
      this.withdrawn = true;
      this.deactivateSession();
    } else if (this.session && ['starting', 'recording'].includes(this.session.phase)
      && !['consent', 'recording'].includes(context.conversation?.status ?? '')) {
      void this.stop('The conversation ended');
    }
  }
  setFocused(focused: boolean) {
    if (!focused) { this.focused = false; this.deactivate(); return; }
    this.focused = true;
    this.update({});
    for (const uri of cleanupURIs) void this.deleteDetached(uri);
  }
  setAppActive(active: boolean) {
    this.appActive = active;
    if (!active) {
      // Permission dialogs may require a second deliberate Start after permission.
      // They must never cause a deferred start to record automatically on return.
      this.withdrawn = true;
      this.deactivateSession();
      this.update({ capturing: false, busy: false, notice: 'App inactive. Capture was withdrawn; it does not restart automatically.' });
    }
  }
  private deactivate() {
    this.withdrawn = true;
    this.deactivateSession();
  }
  private deactivateSession() {
    this.revision++;
    this.update({ autoStartRetryable: false });
    clearTimeout(this.retentionTimer);
    const session = this.session;
    this.session = null;
    if (!session) return;
    this.navigationStopSession = session;
    const serverResultExists = session.finishSubmitted || session.connectionFinished || !!this.context.conversation?.connectedAt
      || (session.eventMode && session.stopSubmitted && !session.connectionOutcomeKnown)
      || ['processing', 'shared'].includes(this.context.conversation?.status ?? '');
    const abandoned = !serverResultExists && (session.phase !== 'ended'
      || (session.file !== null && !session.file.uploaded));
    session.cancelled = true;
    session.abort.abort();
    if (session.file) void this.deleteDetached(session.file.uri);
    // Enqueue native revocation synchronously, not after a server await.
    void this.stopNative(session).then(result => {
      if (result.uri) void this.deleteDetached(result.uri);
      // An explicit navigation discard owns the ACK + deletion barrier. Do not
      // release its route guard early from this automatic cleanup continuation.
      if (!this.navigationTask && this.navigationStopSession === session) {
        this.navigationStopSession = null;
        if (!this.session) this.update({ navigationSafe: true });
      }
    }).catch(() => {});
    // Automatic blur/unmount never destroys an already uploaded/shared result.
    // Explicit cancel() below remains an intentional server cancellation.
    if (abandoned) this.withdrawServer(session);
    else if (session.eventMode && serverResultExists && session.file && !session.file.uploaded) {
      // Backend no-ops if attachment already won the race. Otherwise it closes
      // outstanding upload grants but preserves the connection and its messages.
      void session.client.abandonAudio(session.token, session.cid).catch(() => {});
    }
    this.update({ capturing: false, busy: false, hasUpload: false });
  }

  private liveContext(context = this.context) {
    return this.attached && this.focused && this.appActive
      && this.context.client === context.client && this.context.token === context.token
      && this.context.meId === context.meId
      && this.context.conversation?.id === context.conversation?.id;
  }
  private owns(session: Session) {
    return this.session === session && !session.cancelled && this.liveContext()
      && this.context.client === session.client && this.context.token === session.token
      && this.context.conversation?.id === session.cid
      && this.context.conversation.status !== 'cancelled';
  }
  private mayRecord(session: Session) {
    return this.owns(session) && !this.withdrawn
      && ['starting', 'recording'].includes(session.phase)
      && ['consent', 'recording'].includes(this.context.conversation?.status ?? '');
  }
  private checkStart(session: Session) {
    if (!this.mayRecord(session) || session.phase !== 'starting') throw stale();
  }
  private mayHeartbeat(context: CaptureContext, revision: number) {
    const conversation = this.context.conversation;
    return this.liveContext(context) && revision === this.revision && !this.withdrawn
      && !!conversation && ['consent', 'recording'].includes(conversation.status)
      && !!context.meId && conversation.recordingConsent.includes(context.meId);
  }
  private async presenceHandshake(context: CaptureContext, revision: number, extra: () => boolean) {
    const eligible = () => this.mayHeartbeat(context, revision) && extra();
    // Start and the interval share one lock. The server can reuse an outstanding
    // challenge, so two independent ACK wrappers must never run concurrently.
    for (;;) {
      if (!eligible()) throw stale();
      if (this.presenceRequest) {
        await this.presenceRequest.catch(() => null);
        continue;
      }
      const wait = this.presenceCompletedAt + PRESENCE_SPACING_MS - this.monotonicNow();
      if (wait > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, wait));
        // Recheck consent and reacquire the lock after EVERY asynchronous wait.
        // A competing Start/interval may have claimed the slot while we slept.
        continue;
      }
      break;
    }
    if (!eligible() || !context.client || !context.conversation) throw stale();
    const request = context.client.heartbeat(context.token, context.conversation.id, eligible);
    this.presenceRequest = request;
    try { return await request; }
    finally {
      if (this.presenceRequest === request) {
        this.presenceCompletedAt = this.monotonicNow();
        this.presenceRequest = null;
      }
    }
  }
  private release(session: Session) {
    if (microphoneOwner?.controller === this && microphoneOwner.captureID === session.captureID) microphoneOwner = null;
  }
  private recordStopOutcome(session: Session, outcome: unknown) {
    // Event-mode discard needs the atomic server outcome, never just a lagging
    // React subscription. Missing/old-client responses remain unknown/fail-closed.
    if (typeof outcome !== 'object' || outcome === null || !('connectedAt' in outcome)) return;
    const connectedAt = outcome.connectedAt;
    if (connectedAt === null || (typeof connectedAt === 'number' && Number.isFinite(connectedAt))) {
      session.connectionOutcomeKnown = true;
      if (connectedAt !== null) session.connectionFinished = true;
    }
  }
  private closeServer(session: Session) {
    session.stopSubmitted = true;
    return session.client.stop(session.token, session.cid).then(async outcome => {
      // This continuation must run even if the native-stop finisher returned
      // early after blur/unmount. A peer may already have committed a connection.
      this.recordStopOutcome(session, outcome);
      if (session.eventMode && session.connectionFinished && !this.owns(session)) {
        await session.client.abandonAudio(session.token, session.cid).catch(() => {});
      }
      return outcome;
    });
  }
  private withdrawServer(session: Session) {
    // Even a locally "recording" event may already have been finished by its peer.
    // Only the atomic stop receipt can decide; automatic cleanup must not cancel
    // that unseen connection. Explicit cancel() remains intentionally destructive.
    if (session.eventMode) void this.closeServer(session).catch(() => {});
    else void session.client.cancel(session.token, session.cid).catch(() => {});
  }
  private stopNative(session: Session): Promise<Output> {
    if (!session.nativeStop) {
      session.nativeStop = this.dependencies.audio.stop(session.captureID).then(result => {
        this.release(session);
        return result;
      }).catch(error => {
        // Keep the global claim if native stop is unacknowledged. No second
        // controller may assume ownership while the first recorder may be alive.
        session.nativeStop = undefined;
        throw error;
      });
    }
    return session.nativeStop;
  }
  private async deleteDetached(uri: string) {
    cleanupURIs.add(uri);
    try { await this.dependencies.audio.delete(uri); cleanupURIs.delete(uri); } catch { /* Retry handle retained. */ }
  }
  private async deletePending(session: Session, file: FileRecord) {
    await this.dependencies.audio.delete(file.uri);
    if (session.file === file) {
      session.file = null;
      if (this.session === session) {
        clearTimeout(this.retentionTimer);
        if (this.owns(session)) this.update({ hasUpload: false });
      }
    }
  }

  async start() {
    const context = this.context;
    const conversation = context.conversation;
    if (!this.liveContext(context) || !conversation || !context.client || !context.token) return;
    // Synchronous guards, not React state, arbitrate double taps and back-stack hooks.
    if (this.session || this.navigationStopSession || microphoneOwner || this.withdrawn) {
      this.update({ notice: 'Finish or cancel the existing capture before starting another.' }); return;
    }
    if (conversation.status !== 'consent' || conversation.recorderId !== context.meId
      || conversation.participants.length !== 2
      || !conversation.participants.every(person => conversation.recordingConsent.includes(person.id))) {
      this.update({ notice: 'Both participants must consent, and only the designated recorder can start.' }); return;
    }
    if (!this.dependencies.audio.available()) {
      this.update({ notice: 'Live recording requires the signed iPhone development build with GlanceAudio.' }); return;
    }
    const session: Session = {
      cid: conversation.id, captureID: `glance-${this.now()}-${++sequence}`,
      client: context.client, token: context.token, cancelled: false, phase: 'starting',
      abort: new AbortController(), file: null,
      eventMode: conversation.consentMode === 'event', connectionFinished: !!conversation.connectedAt,
      connectionOutcomeKnown: !!conversation.connectedAt, finishSubmitted: false, stopSubmitted: false,
    };
    this.session = session;
    this.knownCaptures.add(session.captureID);
    microphoneOwner = { controller: this, captureID: session.captureID };
    this.update({ busy: true, notice: '', navigationSafe: false, autoStartRetryable: false });
    let awaitingServerStart = false;
    try {
      await this.dependencies.audio.prepare(session.captureID);
      this.checkStart(session);
      const revision = this.revision;
      await this.presenceHandshake(context, revision, () => this.mayRecord(session));
      this.checkStart(session);
      const ticket = await this.dependencies.audio.ticket();
      this.checkStart(session);
      awaitingServerStart = true;
      const lease = await session.client.startRecording(session.token, session.cid);
      awaitingServerStart = false;
      this.checkStart(session);
      const duration = serverLeaseDuration(lease);
      if (duration <= 0) throw new Error('Backend recording lease expired before start.');
      await this.dependencies.audio.start(duration, ticket, session.captureID);
      this.checkStart(session);
      session.phase = 'recording';
      this.update({ capturing: true, busy: false });
    } catch (error) {
      if (session.phase === 'ending' || session.phase === 'ended') return;
      const showError = this.owns(session);
      const errorRevision = this.revision;
      const retryable = showError && awaitingServerStart && isNotReady(error)
        && this.context.conversation?.status === 'consent';
      if (this.session === session) this.session = null;
      session.cancelled = true;
      session.abort.abort();
      // A late successful backend/native start is closed for this immutable ID.
      if (!retryable) this.withdrawServer(session);
      let nativeClosed = false;
      try {
        const result = await this.stopNative(session);
        nativeClosed = true;
        if (result.uri) await this.deleteDetached(result.uri);
      } catch {
        // Do not advertise retry while the global native owner is unacknowledged.
        if (retryable) this.withdrawServer(session);
      }
      if (showError && errorRevision === this.revision && this.liveContext(context) && this.session === null) {
        this.update({
          busy: false, capturing: false, navigationSafe: nativeClosed,
          autoStartRetryable: retryable && nativeClosed,
          notice: retryable && nativeClosed ? 'Waiting for both phones to be ready. The microphone is off.'
            : message(error),
        });
      }
    }
  }

  async heartbeat() {
    const context = this.context;
    const revision = this.revision;
    if (this.heartbeatBusy || !context.client || !context.conversation
      || !this.mayHeartbeat(context, revision) || this.session?.phase === 'starting') return;
    this.heartbeatBusy = true;
    const session = this.session?.phase === 'recording' ? this.session : null;
    const stillConsenting = () => this.mayHeartbeat(context, revision)
      && (!session || this.mayRecord(session));
    try {
      const ticket = session ? await this.dependencies.audio.ticket() : null;
      if (!stillConsenting()) return;
      const lease = await this.presenceHandshake(context, revision, () => !session || this.mayRecord(session));
      if (!stillConsenting() || !session || !ticket) return;
      if (!lease || serverLeaseDuration(lease) <= 0) { await this.stop('Consent lease ended'); return; }
      await this.dependencies.audio.renew(serverLeaseDuration(lease), ticket, session.captureID);
      if (!stillConsenting()) return;
    } catch {
      if (stillConsenting() && session) this.update({ notice: 'Connection interrupted. The native lease stops capture without another heartbeat.' });
    } finally { this.heartbeatBusy = false; }
  }

  onStopped(event: { captureID: string; uri: string | null; reason: string }) {
    const session = this.session;
    if (!session || session.captureID !== event.captureID || session.cancelled) {
      if (event.uri && this.knownCaptures.has(event.captureID)) void this.deleteDetached(event.uri);
      return;
    }
    this.release(session); // Native event is emitted only after closing the writer.
    if (session.phase === 'ending' || session.phase === 'ended') return;
    void this.stop(event.reason);
  }

  async stop(reason = 'Stopped') {
    this.withdrawn = true;
    this.update({ autoStartRetryable: false });
    this.revision++; // ACK callbacks stop immediately, before native/server work.
    const context = this.context;
    const session = this.session;
    // Machine reasons only. Labels, ordinary Stop, native expiry and interruptions
    // must never be interpreted as a request to connect or share.
    const finishMethod = context.conversation?.consentMode === 'event'
      ? reason === 'gesture' ? 'gesture' : reason === 'finish_button' ? 'button' : undefined
      : undefined;
    if (!session) {
      if (!context.client || !context.conversation || !this.liveContext(context)) return;
      const revision = this.revision;
      this.update({ capturing: false, busy: true, navigationSafe: false });
      try {
        if (finishMethod) await context.client.finishConnection(context.token, context.conversation.id, finishMethod);
        else await context.client.stop(context.token, context.conversation.id);
        if (this.liveContext(context) && revision === this.revision) this.update({
          notice: finishMethod ? 'Connection confirmed. The recording device is preparing the recap.'
            : 'Stop requested. No further presence acknowledgments will be sent.',
        });
      } catch (error) {
        if (this.liveContext(context) && revision === this.revision) this.update({ notice: message(error) });
      } finally {
        if (this.liveContext(context) && revision === this.revision) this.update({ busy: false, navigationSafe: true });
      }
      return;
    }
    if (session.finishing) return session.finishing;
    session.finishMethod = finishMethod;
    session.phase = 'ending';
    this.update({ capturing: false, busy: true, navigationSafe: false, notice: `${reason}. Stopping the iPhone microphone.` });
    const nativeStop = this.stopNative(session);
    // Observe rejection immediately even if native stop is slow.
    // Explicit event finish MUST wait for native close and must not first call stop.
    const serverStop = finishMethod ? null
      : this.closeServer(session).then(
        value => ({ ok: true as const, value }),
        error => ({ ok: false as const, error }),
      );
    session.finishing = (async () => {
      try {
        const result = await nativeStop;
        if (!this.owns(session)) {
          if (result.uri) await this.deleteDetached(result.uri);
          return;
        }
        session.phase = 'ended';
        if (result.uri && !session.file) {
          session.file = { uri: result.uri, expiresAt: this.now() + RAW_AUDIO_RETENTION_MS, uploaded: false };
          this.update({ hasUpload: true });
          this.scheduleRetention(session, session.file);
        }
        if (session.finishMethod) {
          session.finishSubmitted = true; // Preserve a possibly committed connection before its ACK/subscription.
          await session.client.finishConnection(session.token, session.cid, session.finishMethod);
          session.connectionFinished = true;
          session.connectionOutcomeKnown = true;
          if (!this.owns(session)) {
            await session.client.abandonAudio(session.token, session.cid).catch(() => {});
            return;
          }
        } else {
          const outcome = await serverStop;
          if (!outcome?.ok) throw outcome?.error ?? new Error('Stop outcome was unavailable.');
          if (!this.owns(session)) return;
        }
        if (session.eventMode && !session.connectionFinished) {
          if (!session.connectionOutcomeKnown) throw new Error('Waiting for the authoritative connection outcome. Retry to reconcile safely.');
          if (session.file) await this.deletePending(session, session.file);
          if (this.owns(session)) this.update({ navigationSafe: true, notice: 'Recording stopped without connecting or sharing.' });
          return;
        }
        if (session.eventMode && !session.file) {
          await session.client.abandonAudio(session.token, session.cid);
          if (this.owns(session)) this.update({
            navigationSafe: true, notice: 'Connection confirmed, but no usable recording was produced. Chat remains available.',
          });
          return;
        }
        await this.sendPending(session);
        if (this.owns(session)) this.update({
          navigationSafe: !session.file || session.file.uploaded,
          notice: session.eventMode ? 'Connection confirmed. Your recap is being prepared.'
            : 'Recording ended. Confirm separately before exchanging a recap.',
        });
      } catch (error) {
        if (this.owns(session)) this.update({ notice: `${message(error)} Capture does not restart. Retry upload or discard the local recording.` });
      } finally {
        if (this.owns(session)) {
          this.update({ busy: false });
          if (session.phase === 'ended' && !session.file) this.session = null;
        }
      }
    })();
    return session.finishing;
  }

  private scheduleRetention(session: Session, file: FileRecord) {
    clearTimeout(this.retentionTimer);
    this.retentionTimer = setTimeout(() => {
      if (!this.owns(session) || session.file !== file) return;
      session.abort.abort();
      void this.deletePending(session, file).then(() => {
        if (session.eventMode && session.connectionFinished) {
          void session.client.abandonAudio(session.token, session.cid).catch(() => {});
        }
        if (this.owns(session)) this.update({ navigationSafe: true, notice: 'Temporary local recording expired and was deleted.' });
      }).catch(() => {
        if (this.owns(session)) this.update({ notice: 'Temporary recording expired. Local deletion failed; retry discard.' });
      });
    }, Math.max(0, file.expiresAt - this.now()));
  }

  private async sendPending(session: Session) {
    if (session.uploading) return session.uploading;
    const file = session.file;
    if (!file || !this.owns(session) || (session.eventMode && !session.connectionFinished)) return;
    const eligible = () => this.owns(session) && session.file === file
      && !session.abort.signal.aborted && this.now() < file.expiresAt;
    session.uploading = (async () => {
      if (this.now() >= file.expiresAt) {
        await this.deletePending(session, file);
        throw new Error('Temporary recording expired.');
      }
      if (!eligible()) return;
      if (!file.uploaded) {
        const url = await session.client.createUploadUrl(session.token, session.cid);
        if (!eligible()) return;
        const storageID = await this.dependencies.upload(url, file.uri, session.abort.signal);
        if (!eligible()) return;
        await session.client.attachAudio(session.token, session.cid, storageID, 'audio/wav');
        if (!eligible()) return;
        file.uploaded = true;
        this.update({ navigationSafe: true });
      }
      await this.deletePending(session, file);
    })().finally(() => { session.uploading = undefined; });
    return session.uploading;
  }

  async retryUpload() {
    const session = this.session;
    if (!session || !this.owns(session) || !session.file || this.view.busy || session.uploading) return;
    this.update({ busy: true });
    try {
      if (session.eventMode && !session.connectionFinished && session.finishMethod) {
        // Retry only a previously explicit finish. Never infer sharing from Retry.
        session.finishSubmitted = true;
        await session.client.finishConnection(session.token, session.cid, session.finishMethod);
        session.connectionFinished = true;
        session.connectionOutcomeKnown = true;
        if (!this.owns(session)) {
          await session.client.abandonAudio(session.token, session.cid).catch(() => {});
          return;
        }
      } else if (!session.eventMode || !session.connectionFinished) {
        await this.closeServer(session);
        if (!this.owns(session)) return;
      }
      if (!this.owns(session)) return;
      if (session.eventMode && !session.connectionFinished) {
        if (!session.connectionOutcomeKnown) throw new Error('Connection outcome remains unknown. The local recording has not been shared.');
        await this.deletePending(session, session.file!);
        if (this.owns(session)) this.update({ navigationSafe: true, notice: 'Recording discarded. No connection was confirmed.' });
        return;
      }
      await this.sendPending(session);
      if (this.owns(session)) this.update({
        navigationSafe: !session.file || session.file.uploaded,
        notice: session.eventMode ? 'Audio uploaded. The connection recap is being prepared.'
          : 'Audio uploaded. Both participants must confirm the exchange.',
      });
    } catch (error) {
      if (this.owns(session)) this.update({ notice: message(error) });
    } finally {
      if (this.owns(session)) {
        this.update({ busy: false });
        if (session.phase === 'ended' && !session.file) this.session = null;
      }
    }
  }

  async cancel() {
    const context = this.context;
    this.withdrawn = true;
    this.deactivateSession(); // Native stop and AbortController fire synchronously.
    const revision = this.revision;
    if (!context.client || !context.conversation) return;
    this.update({ busy: true });
    try {
      await context.client.cancel(context.token, context.conversation.id);
      if (this.liveContext(context) && revision === this.revision) this.update({ notice: 'Conversation cancelled. Local capture is off.' });
    } catch (error) {
      if (this.liveContext(context) && revision === this.revision) this.update({ notice: `${message(error)} Local consent remains withdrawn.` });
    } finally {
      if (this.liveContext(context) && revision === this.revision) this.update({ busy: false });
    }
  }

  /**
   * Explicit navigation/discard barrier for EVERY local phase, not just connected
   * uploads. Rejects and retains the scope if native close or local deletion fails.
   */
  async discardLocal() {
    if (this.navigationTask) return this.navigationTask;
    const session = this.session ?? this.navigationStopSession;
    this.withdrawn = true;
    if (!session) {
      if (microphoneOwner?.controller === this) throw new Error('Native microphone ownership is unresolved. Retry stopping before leaving.');
      this.revision++;
      this.update({ capturing: false, busy: false, autoStartRetryable: false, navigationSafe: true });
      return;
    }
    const context = this.context;
    this.navigationStopSession = session;
    this.deactivateSession();
    session.cancelled = true;
    session.abort.abort();
    this.update({ busy: true, navigationSafe: false });
    const task = (async () => {
      try {
        const result = await this.stopNative(session);
        // ACK alone is not completion: await each deletion, and retain all failed
        // URI handles so a second confirmed discard can retry without a new mic.
        const uris = new Set([session.file?.uri, result.uri].filter((uri): uri is string => !!uri));
        for (const uri of uris) {
          cleanupURIs.add(uri);
          await this.dependencies.audio.delete(uri);
          cleanupURIs.delete(uri);
        }
        session.file = null;
        if (session.eventMode && (session.connectionFinished || session.finishSubmitted
          || (session.stopSubmitted && !session.connectionOutcomeKnown) || context.conversation?.connectedAt)) {
          // This endpoint may reject before an uncertain finish commits. The
          // independent late finish/stop receipt continuation retries it safely.
          await session.client.abandonAudio(session.token, session.cid).catch(() => {});
        }
        if (this.navigationStopSession === session) this.navigationStopSession = null;
        if (this.context.conversation?.id === context.conversation?.id && this.context.client === context.client) {
          this.update({
            busy: false, hasUpload: false, navigationSafe: true,
            notice: 'The microphone is off and local audio was discarded. Existing connections and messages are preserved.',
          });
        }
      } catch (error) {
        // Do not release the route guard on an unacknowledged close or failed
        // deletion. stopNative resets a rejected promise so this scope can retry.
        this.navigationStopSession = session;
        if (this.context.conversation?.id === context.conversation?.id && this.context.client === context.client) {
          this.update({ busy: false, navigationSafe: false, notice: `${message(error)} Retry discard before leaving.` });
        }
        throw error;
      }
    })().finally(() => {
      if (this.navigationTask === task) this.navigationTask = null;
    });
    this.navigationTask = task;
    return task;
  }
}
