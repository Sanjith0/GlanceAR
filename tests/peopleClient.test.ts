import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { syncStep } from '../src/discover/people';
import { talkingPoints } from '../src/talkingPoints';
import type { DiscoverSession, FacebookRead } from '../src/discover/api';

const api = vi.hoisted(() => ({ beginFacebook: vi.fn(), completeFacebook: vi.fn() }));
vi.mock('../src/discover/api', () => api);
// Imported after the mock so the sign-in module talks to the stand-in backend calls above.
import {
  FacebookCancelled, announceFacebookReturn, connectFacebook, facebookConnectAvailable, openFacebookWindow, parseFacebookReturn,
} from '../src/discover/facebook';

const STATE = 'a1'.repeat(32), OTHER = 'b2'.repeat(32);
const session: DiscoverSession = { muse: 'ready', deploymentURL: 'http://127.0.0.1:3210', token: 'device-token', intro: '' };
const READ: FacebookRead = { interests: ['bouldering'], summary: 'Climbing.', pages: 3, posts: 1, revoked: true };

describe('recognising the address Facebook returns to', () => {
  it('reads an approved sign-in', () => {
    expect(parseFacebookReturn(`?code=AQD-code_1&state=${STATE}`)).toEqual({ state: STATE, code: 'AQD-code_1' });
    expect(parseFacebookReturn(`state=${STATE}&code=x`)).toEqual({ state: STATE, code: 'x' });
  });
  it('reads a cancel, with or without the state', () => {
    expect(parseFacebookReturn(`?error=access_denied&error_reason=user_denied&error_description=Permissions+error&state=${STATE}`))
      .toEqual({ state: STATE, error: 'access_denied' });
    expect(parseFacebookReturn('?error=access_denied')).toEqual({ state: '', error: 'access_denied' });
  });
  it('keeps only a short, plain error code', () => {
    expect(parseFacebookReturn('?error=<script>alert(1)</script>')).toEqual({ state: '', error: 'scriptalertscript' });
    expect(parseFacebookReturn(`?error=${'e'.repeat(90)}`)?.error).toHaveLength(40);
  });
  it.each([
    ['an ordinary visit', ''],
    ['a hosting query', '?preview=1'],
    ['a code without a state', '?code=abc'],
    ['a state without a code', `?state=${STATE}`],
    ['a state of the wrong shape', '?code=abc&state=not-a-state'],
    ['an upper-case state', `?code=abc&state=${STATE.toUpperCase()}`],
    ['an over-long code', `?code=${'c'.repeat(4001)}&state=${STATE}`],
    ['a cancel carrying a forged state', '?error=access_denied&state=nope'],
    ['an empty error', `?error=&state=${STATE}`],
  ])('ignores %s', (_name, search) => expect(parseFacebookReturn(search)).toBeNull());
});

describe('the sign-in window', () => {
  type Popup = { close: ReturnType<typeof vi.fn>; location: { href: string } };
  const popup = (): Popup => ({ close: vi.fn(), location: { href: 'about:blank' } });
  const asWindow = (value: Popup) => value as unknown as Window;
  /** Stands in for the pop-up after Facebook sent it back: posts a result, collects the replies. */
  const returning = () => {
    const channel = new BroadcastChannel('glance-facebook');
    const replies: unknown[] = [];
    channel.onmessage = (event) => { replies.push(event.data); };
    return { channel, replies, post: (result: unknown) => channel.postMessage({ kind: 'return', result }) };
  };
  const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
  let other: ReturnType<typeof returning>;

  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { origin: 'https://glance.test', pathname: '/', search: '' },
      history: { state: null, replaceState: vi.fn() }, open: vi.fn(), close: vi.fn(),
    });
    api.beginFacebook.mockReset().mockResolvedValue({ url: 'https://facebook.test/dialog', state: STATE });
    api.completeFacebook.mockReset().mockResolvedValue(READ);
    other = returning();
  });
  afterEach(() => { other.channel.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('opens a named window straight away, and reports when it cannot', () => {
    expect(facebookConnectAvailable()).toBe(true);
    const opened = popup();
    (window.open as ReturnType<typeof vi.fn>).mockReturnValue(opened);
    expect(openFacebookWindow()).toBe(opened);
    expect(window.open).toHaveBeenCalledWith('', 'glance-facebook', 'popup,width=600,height=760');
    (window.open as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('blocked'); });
    expect(openFacebookWindow()).toBeNull();
  });
  it('refuses to start without a window, before asking the backend', async () => {
    await expect(connectFacebook(session, null, new AbortController().signal)).rejects.toThrow(/blocked the Facebook window/);
    expect(api.beginFacebook).not.toHaveBeenCalled();
  });
  it('completes the sign-in it started and acknowledges the window', async () => {
    const opened = popup();
    const done = connectFacebook(session, asWindow(opened), new AbortController().signal);
    await settle();
    expect(api.beginFacebook).toHaveBeenCalledWith(session, 'https://glance.test/');
    expect(opened.location.href).toBe('https://facebook.test/dialog');
    // Someone else's sign-in, or a replayed one, is not ours to finish.
    other.post({ state: OTHER, code: 'not-ours' });
    other.post({ state: OTHER, error: 'access_denied' });
    await settle();
    expect(api.completeFacebook).not.toHaveBeenCalled();
    other.post({ state: STATE, code: 'the-code' });
    await expect(done).resolves.toEqual(READ);
    expect(api.completeFacebook).toHaveBeenCalledExactlyOnceWith(session, STATE, 'the-code');
    await settle();
    expect(other.replies).toEqual([{ kind: 'received', state: STATE }]);
    expect(opened.close).not.toHaveBeenCalled();
  });
  it('treats a cancel on Facebook as cancelled, even when the state did not come back', async () => {
    for (const result of [{ state: STATE, error: 'access_denied' }, { state: '', error: 'access_denied' }]) {
      const done = connectFacebook(session, asWindow(popup()), new AbortController().signal);
      await settle();
      other.post(result);
      await expect(done).rejects.toBeInstanceOf(FacebookCancelled);
    }
    expect(api.completeFacebook).not.toHaveBeenCalled();
  });
  it('reports any other Facebook error as a failure', async () => {
    const done = connectFacebook(session, asWindow(popup()), new AbortController().signal);
    await settle();
    other.post({ state: STATE, error: 'server_error' });
    await expect(done).rejects.toThrow(/did not complete the sign-in/);
    expect(api.completeFacebook).not.toHaveBeenCalled();
  });
  it('never completes from a message without a code', async () => {
    const done = connectFacebook(session, asWindow(popup()), new AbortController().signal);
    await settle();
    other.post({ state: STATE });
    await expect(done).rejects.toThrow(/did not complete the sign-in/);
    expect(api.completeFacebook).not.toHaveBeenCalled();
  });
  it('closes the window and stops when the person cancels here', async () => {
    const opened = popup(), abort = new AbortController();
    const done = connectFacebook(session, asWindow(opened), abort.signal);
    await settle();
    abort.abort();
    await expect(done).rejects.toBeInstanceOf(FacebookCancelled);
    expect(opened.close).toHaveBeenCalledOnce();
    // A late return from that window is no longer listened for.
    other.post({ state: STATE, code: 'late' });
    await settle();
    expect(api.completeFacebook).not.toHaveBeenCalled();
    expect(other.replies).toEqual([]);
  });
  it('closes the window when the backend cannot start a sign-in, or it was cancelled meanwhile', async () => {
    const failed = popup();
    api.beginFacebook.mockRejectedValueOnce(new Error('Facebook Login is not set up on this backend.'));
    await expect(connectFacebook(session, asWindow(failed), new AbortController().signal)).rejects.toThrow(/not set up/);
    expect(failed.close).toHaveBeenCalledOnce();

    const late = popup(), abort = new AbortController();
    abort.abort();
    await expect(connectFacebook(session, asWindow(late), abort.signal)).rejects.toBeInstanceOf(FacebookCancelled);
    expect(late.close).toHaveBeenCalledOnce();
    expect(late.location.href).toBe('about:blank');
  });
  it('gives up after five minutes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const opened = popup();
    const done = connectFacebook(session, asWindow(opened), new AbortController().signal);
    const failure = expect(done).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await failure;
    expect(opened.close).toHaveBeenCalledOnce();
  });

  it('hands the result to the page that asked, clears the address and closes itself', async () => {
    const received: boolean[] = [];
    // The opening page: acknowledges exactly as connectFacebook does.
    other.channel.onmessage = (event) => {
      other.replies.push(event.data);
      other.channel.postMessage({ kind: 'received', state: event.data.result.state });
    };
    announceFacebookReturn({ state: STATE, code: 'the-code' }, (value) => received.push(value));
    expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '/');
    await settle(60);
    expect(other.replies).toEqual([{ kind: 'return', result: { state: STATE, code: 'the-code' } }]);
    expect(received).toEqual([true]);
    expect(window.close).toHaveBeenCalledOnce();
  });
  it('ignores an acknowledgment for another sign-in and says so when nobody answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const received: boolean[] = [];
    announceFacebookReturn({ state: STATE, code: 'the-code' }, (value) => received.push(value));
    other.channel.postMessage({ kind: 'received', state: OTHER });
    await vi.advanceTimersByTimeAsync(3_999);
    expect(received).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(received).toEqual([false]);
    expect(window.close).not.toHaveBeenCalled();
  });
  it('still reports when the address cannot be changed (a sandboxed preview)', async () => {
    (window.history.replaceState as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('SecurityError'); });
    const received: boolean[] = [];
    const stop = announceFacebookReturn({ state: '', error: 'access_denied' }, (value) => received.push(value));
    await settle();
    expect(other.replies).toEqual([{ kind: 'return', result: { state: '', error: 'access_denied' } }]);
    stop();
    expect(received).toEqual([]);
  });
});

describe('talking points with people matching', () => {
  const me = { role: 'Builder · human-centered AI' };
  it('leads with what you share and the opener', () => {
    expect(talkingPoints(me, { role: 'Designer · creative tools', shared: ['bouldering', 'coffee'], opener: 'Where do you climb around here?' }, 'Builders Night'))
      .toEqual(['You’re both into bouldering and coffee', 'Where do you climb around here?', 'Ask what they’re working on as a designer']);
  });
  it('names at most three shared interests and never more than three points', () => {
    const points = talkingPoints(me, { role: 'Designer', shared: ['a1', 'b2', 'c3', 'd4'], opener: 'Which one first?' });
    expect(points[0]).toBe('You’re both into a1, b2 and c3');
    expect(points).toHaveLength(3);
  });
  it('works without an opener and is unchanged without a match', () => {
    expect(talkingPoints(me, { role: 'Designer', shared: ['jazz'] })[0]).toBe('You’re both into jazz');
    const plain = talkingPoints(me, { role: 'Designer · creative tools' }, 'Builders Night');
    expect(talkingPoints(me, { role: 'Designer · creative tools', shared: [] }, 'Builders Night')).toEqual(plain);
    expect(talkingPoints(me, { role: 'Designer · creative tools', opener: 'Ignored without anything shared' }, 'Builders Night')).toEqual(plain);
  });
});

describe('keeping the saved interests in step with this device', () => {
  const sent = (list: string[]) => JSON.stringify(list);
  it('does nothing while people matching is off', () => {
    expect(syncStep(['coffee'], undefined, false, null)).toBe('idle');
    expect(syncStep([], undefined, true, null)).toBe('idle');
  });
  it('takes the saved list once, on a device that starts empty', () => {
    expect(syncStep([], ['coffee'], false, null)).toBe('hydrate');
    // Afterwards an empty list is the person clearing it, which is saved.
    expect(syncStep([], ['coffee'], true, null)).toBe('push');
    expect(syncStep([], [], false, null)).toBe('idle');
  });
  it('saves this device’s list when it differs, and not twice', () => {
    expect(syncStep(['coffee', 'jazz'], ['coffee'], true, null)).toBe('push');
    expect(syncStep(['coffee', 'jazz'], ['coffee'], false, null)).toBe('push');
    expect(syncStep(['coffee', 'jazz'], ['coffee'], true, sent(['coffee', 'jazz']))).toBe('idle');
    expect(syncStep(['coffee', 'jazz'], ['coffee', 'jazz'], true, null)).toBe('idle');
    expect(syncStep(['jazz', 'coffee'], ['coffee', 'jazz'], true, null)).toBe('push');
  });
});

describe('backend environment variables', () => {
  // The node executor swaps process.env between invocations, so `import { env } from "node:process"`
  // keeps showing the variables from the first run and misses ones set later.
  it('are read from process.env at call time, never through an imported binding', () => {
    const root = join(__dirname, '..', 'convex');
    const files = readdirSync(root).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(10);
    for (const name of files) expect(readFileSync(join(root, name), 'utf8'), name).not.toMatch(/from\s+["']node:process["']/);
  });
});
