import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { ConvexError } from 'convex/values';
import { basicRecommend, signalsKey, type Recommendation, type Signals, type TasteRead } from './catalog';
import { getDiscover, setDiscover } from './store';

export interface DiscoverSession {
  /**
   * 'ready': a configured backend and a registered profile, so Muse can be asked.
   * 'sample': the in-memory walkthrough. 'no-profile': a backend, but no profile yet.
   */
  muse: 'ready' | 'sample' | 'no-profile';
  deploymentURL: string;
  token: string;
  intro: string;
}

export const SAMPLE_NOTICE = 'Sample walkthrough: a basic keyword match. Muse Spark ranks these when the backend is connected.';
export const NO_PROFILE_NOTICE = 'Create your Glance profile to get Muse picks. Showing a basic keyword match for now.';

let http: { url: string; client: ConvexHttpClient } | undefined;
const backend = (url: string) => (http?.url === url ? http : (http = { url, client: new ConvexHttpClient(url) })).client;
const message = (error: unknown, fallback: string) =>
  error instanceof ConvexError && typeof error.data === 'string' ? error.data : fallback;

/** Identifies the signals and the ranking path a set of picks belongs to. */
export function rankKey(session: DiscoverSession, state = getDiscover()): string {
  return `${session.muse}|${signalsKey(state.useIntro ? session.intro : '', state.interests)}`;
}

let generation = 0;
/** Ranks the catalog for the current signals and publishes the picks to the store. */
export async function rankForSession(session: DiscoverSession): Promise<void> {
  const state = getDiscover();
  const signals: Signals = { interests: state.interests, intro: state.useIntro ? session.intro : '', summary: state.summary };
  const key = rankKey(session, state);
  const mine = ++generation;
  if (!signals.interests.length && !signals.intro.trim()) { setDiscover({ recs: null, recsKey: key, ranking: false }); return; }
  setDiscover({ ranking: true });
  let recs: Recommendation;
  if (session.muse !== 'ready') {
    recs = { ...basicRecommend(signals), notice: session.muse === 'sample' ? SAMPLE_NOTICE : NO_PROFILE_NOTICE };
  } else {
    try {
      recs = await backend(session.deploymentURL).action(anyApi.discover.recommend, {
        token: session.token, interests: signals.interests, summary: signals.summary, useIntro: state.useIntro,
      }) as Recommendation;
    } catch (error) {
      recs = { ...basicRecommend(signals), notice: `${message(error, 'The backend could not rank these events.')} Showing a basic keyword match instead.` };
    }
  }
  // A newer request owns the result; drop this one.
  if (mine !== generation) return;
  setDiscover({ recs, recsKey: key, ranking: false });
}

/** Muse Spark vision reads interests from a screenshot data URL. Needs the backend; there is no offline stand-in. */
export async function readScreenshot(session: DiscoverSession, image: string): Promise<TasteRead> {
  if (session.muse !== 'ready') throw new Error('Reading a screenshot runs on Muse Spark and needs the backend and your Glance profile.');
  try {
    return await backend(session.deploymentURL).action(anyApi.discover.readScreenshot, { token: session.token, image }) as TasteRead;
  } catch (error) {
    throw new Error(message(error, 'The backend could not read your screenshot.'));
  }
}

/* ---------- People matching and Facebook sign-in (need the backend and a profile) ---------- */

const NEEDS_PROFILE = 'This needs the backend and your Glance profile.';

/** Switches people matching on, or replaces the saved list. Returns the list as the server stored it. */
export async function saveInterests(session: DiscoverSession, interests: string[]): Promise<string[]> {
  if (session.muse !== 'ready') throw new Error(NEEDS_PROFILE);
  try {
    return await backend(session.deploymentURL).mutation(anyApi.peopleData.saveInterests, { token: session.token, interests }) as string[];
  } catch (error) {
    throw new Error(message(error, 'The backend could not save your interests.'));
  }
}
/** Switches people matching off and deletes the saved list. */
export async function clearInterests(session: DiscoverSession): Promise<void> {
  if (session.muse !== 'ready') throw new Error(NEEDS_PROFILE);
  try {
    await backend(session.deploymentURL).mutation(anyApi.peopleData.clearInterests, { token: session.token });
  } catch (error) {
    throw new Error(message(error, 'The backend could not switch people matching off.'));
  }
}
export type MatchOutcome = 'muse' | 'basic' | 'current' | 'stale';
/** Asks Muse Spark what you share with the other opted-in people at one event. The answer arrives in the snapshot. */
export async function matchPeople(deploymentURL: string, token: string, eventId: string, force = false): Promise<MatchOutcome> {
  try {
    return await backend(deploymentURL).action(anyApi.people.match, { token, eventId, ...(force ? { force } : {}) }) as MatchOutcome;
  } catch (error) {
    throw new Error(message(error, 'The backend could not match you with people here.'));
  }
}
export interface FacebookRead extends TasteRead { pages: number; posts: number; revoked: boolean }
export async function beginFacebook(session: DiscoverSession, redirectUri: string): Promise<{ url: string; state: string }> {
  if (session.muse !== 'ready') throw new Error(NEEDS_PROFILE);
  try {
    return await backend(session.deploymentURL).action(anyApi.facebook.begin, { token: session.token, redirectUri }) as { url: string; state: string };
  } catch (error) {
    throw new Error(message(error, 'The backend could not start Facebook sign-in.'));
  }
}
export async function completeFacebook(session: DiscoverSession, state: string, code: string): Promise<FacebookRead> {
  try {
    return await backend(session.deploymentURL).action(anyApi.facebook.complete, { token: session.token, state, code }) as FacebookRead;
  } catch (error) {
    throw new Error(message(error, 'The backend could not read your Facebook activity.'));
  }
}
