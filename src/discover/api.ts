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
