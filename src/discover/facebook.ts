/**
 * "Connect Facebook" on the web, as a pop-up sign-in.
 *
 * The web device credential lives only in this page's memory, so the page that
 * starts the sign-in must also finish it: a full-page redirect would lose the
 * session. The pop-up goes to Facebook's Login dialog and comes back to the app's
 * own address, where `announceFacebookReturn` hands the one-time code to this page
 * over a same-origin BroadcastChannel and closes itself.
 *
 * Nothing here touches cookies or browser storage, and nothing relies on
 * `window.opener` or `popup.closed`: Facebook's pages isolate their window, which
 * cuts that link in both directions.
 */
import { beginFacebook, completeFacebook, type DiscoverSession, type FacebookRead } from './api';

const CHANNEL = 'glance-facebook';
const WAIT_MS = 5 * 60_000;

export interface FacebookReturn {
  /** The one-time state this sign-in was started with; empty when Facebook did not send it back. */
  state: string;
  code?: string;
  error?: string;
}
type Message = { kind: 'return'; result: FacebookReturn } | { kind: 'received'; state: string };

/**
 * Recognises the address Facebook sends the pop-up back to: `?code=…&state=…`
 * after approval, `?error=access_denied&…` after a cancel. Anything else is an
 * ordinary visit and returns null.
 */
export function parseFacebookReturn(search: string): FacebookReturn | null {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const sent = query.get('state') ?? '';
  const state = /^[a-f0-9]{64}$/.test(sent) ? sent : '';
  const code = query.get('code') ?? '';
  if (state && code && code.length <= 4_000) return { state, code };
  const error = (query.get('error') ?? '').replace(/[^a-z_]/gi, '').slice(0, 40);
  // A cancel may arrive without the state; it can only ever stop a sign-in, never complete one.
  if (error && (state || !sent)) return { state, error };
  return null;
}

export const facebookConnectAvailable = (): boolean =>
  typeof window !== 'undefined' && typeof window.open === 'function' && typeof BroadcastChannel === 'function';

/**
 * Opens the sign-in window. Call this directly from the press handler, before any
 * await, or the browser treats it as an unrequested pop-up and blocks it.
 */
export function openFacebookWindow(): Window | null {
  if (!facebookConnectAvailable()) return null;
  try { return window.open('', CHANNEL, 'popup,width=600,height=760'); } catch { return null; }
}

/** Thrown when the person backed out, here or on Facebook. Not a failure worth an error banner. */
export class FacebookCancelled extends Error {
  constructor() { super('Facebook sign-in was cancelled. Nothing was read.'); this.name = 'FacebookCancelled'; }
}

function waitForReturn(state: string, signal: AbortSignal): Promise<FacebookReturn> {
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(CHANNEL);
    const finish = (settle: () => void) => {
      clearTimeout(timer); signal.removeEventListener('abort', abort); channel.close(); settle();
    };
    const abort = () => finish(() => reject(new FacebookCancelled()));
    const timer = setTimeout(() => finish(() => reject(new Error('Facebook sign-in timed out. Start again.'))), WAIT_MS);
    channel.onmessage = (event: MessageEvent<Message>) => {
      const message = event.data;
      if (message?.kind !== 'return' || !message.result) return;
      const { result } = message;
      // Only the sign-in this page started; a stateless message may cancel it but never complete it.
      if (result.state !== state && !(result.error && !result.state)) return;
      channel.postMessage({ kind: 'received', state: result.state } satisfies Message);
      finish(() => resolve(result));
    };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort);
  });
}

/**
 * Runs one sign-in in the window from `openFacebookWindow` and returns the interests
 * Muse Spark read. Throws FacebookCancelled when the person cancels.
 */
export async function connectFacebook(session: DiscoverSession, popup: Window | null, signal: AbortSignal): Promise<FacebookRead> {
  if (!popup) throw new Error('Your browser blocked the Facebook window. Allow pop-ups for this site, then try again.');
  const close = () => { try { popup.close(); } catch { /* Already gone, or no longer ours to close. */ } };
  let started: { url: string; state: string };
  try {
    started = await beginFacebook(session, `${window.location.origin}/`);
  } catch (error) { close(); throw error; }
  if (signal.aborted) { close(); throw new FacebookCancelled(); }
  // Listen before the window leaves for Facebook, so a fast return cannot be missed.
  const returned = waitForReturn(started.state, signal);
  try { popup.location.href = started.url; } catch { /* A closed window: the wait below ends on cancel or timeout. */ }
  let result: FacebookReturn;
  try { result = await returned; } catch (error) { close(); throw error; }
  if (!result.code) {
    if (result.error === 'access_denied') throw new FacebookCancelled();
    throw new Error('Facebook did not complete the sign-in. Try again, or type your interests instead.');
  }
  return completeFacebook(session, result.state, result.code);
}

/**
 * Runs in the pop-up once Facebook has sent it back: passes the result to the page
 * that started the sign-in, takes the code out of the address bar, and closes the
 * window. `onDone` reports whether that page answered.
 */
export function announceFacebookReturn(result: FacebookReturn, onDone: (received: boolean) => void): () => void {
  try { window.history.replaceState(window.history.state, '', window.location.pathname); } catch { /* Sandboxed previews refuse history changes. */ }
  if (typeof BroadcastChannel !== 'function') { onDone(false); return () => {}; }
  const channel = new BroadcastChannel(CHANNEL);
  let done = false;
  const finish = (received: boolean) => {
    if (done) return;
    done = true; clearTimeout(timer); channel.close(); onDone(received);
    if (received) { try { window.close(); } catch { /* The page says the window can be closed. */ } }
  };
  channel.onmessage = (event: MessageEvent<Message>) => {
    if (event.data?.kind === 'received' && event.data.state === result.state) finish(true);
  };
  const timer = setTimeout(() => finish(false), 4_000);
  channel.postMessage({ kind: 'return', result } satisfies Message);
  return () => { if (!done) { done = true; clearTimeout(timer); channel.close(); } };
}
