/**
 * People matching: what two attendees of the same event have in common.
 * Pure helpers shared by the app and the Convex backend; no React or native imports.
 *
 * The rule everything here protects: a viewer is only ever shown phrases from
 * their own interest list. Another attendee's wording, the rest of their list
 * and how long it is never reach the viewer's device.
 */
import { stem } from './catalog';
import type { Snapshot } from '../domain';

/** What one attendee has in common with the viewer. */
export interface SharedWith {
  /** The viewer's own interests this person shares. */
  shared: string[];
  /** One question the viewer could open with, about something they share. */
  opener: string;
}
/** Server side only: an opted-in attendee and the interests they saved. */
export interface Candidate { id: string; interests: string[] }

/** Fictional interests for the sample attendees, so the walkthrough can show a match. */
export const SAMPLE_PEOPLE_INTERESTS: Readonly<Record<string, readonly string[]>> = {
  alex: ['ai agents', 'coffee', 'trail running', 'synthesizers', 'board games'],
  sam: ['film photography', 'indie music', 'street food', 'ceramics', 'typography'],
};

const tidy = (value: string) => value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const FILLER = new Set(['a', 'an', 'and', 'the', 'of']);
/**
 * Every word of an interest phrase, lower-cased with plurals folded. Unlike the
 * event catalog's keywords nothing meaningful is dropped, so "night club" and
 * "live events" still match themselves; only filler words go, and not even those
 * when they are all there is.
 */
function phraseWords(phrase: string): string[] {
  const all = phrase.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(stem);
  const kept = all.filter((word) => !FILLER.has(word));
  return kept.length ? kept : all;
}
const endsWith = (outer: string[], inner: string[]) => inner.length > 0 && inner.length <= outer.length
  && inner.every((word, offset) => outer[outer.length - inner.length + offset] === word);

/**
 * The viewer's interests the other person also listed, always in the viewer's own
 * wording. The same words always count. With `loose`, so does one phrase ending in
 * the other ("coffee" and "specialty coffee"): a rough guess used only while Muse
 * has not judged the two lists, since it also links "arts" to "martial arts".
 */
export function sharedInterests(mine: string[], theirs: string[], loose = true): string[] {
  const other = theirs.map(phraseWords).filter((words) => words.length > 0);
  return mine.filter((phrase) => {
    const own = phraseWords(phrase);
    return own.length > 0 && other.some((words) => (loose
      ? endsWith(words, own) || endsWith(own, words)
      : words.length === own.length && endsWith(words, own)));
  });
}

/** A plain opener for when Muse did not write one. */
export const basicOpener = (shared: string[]): string => (shared.length ? `What got you into ${shared[0]}?` : '');

/** The stand-in name each candidate goes by in a Muse request, so no profile id or name is sent. */
export const candidateRef = (index: number): string => `p${index + 1}`;

/**
 * Muse's semantic pairs, kept only where the two phrases really are in the two
 * people's lists. Returns candidate id → the viewer's phrases, never the other person's.
 */
export function validatePairs(raw: unknown, mine: string[], candidates: Candidate[]): Map<string, string[]> {
  const own = new Map(mine.map((phrase) => [phrase.toLowerCase(), phrase]));
  const byRef = new Map(candidates.map((candidate, index) => [candidateRef(index), candidate]));
  const out = new Map<string, string[]>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { person, pairs } = item as Record<string, unknown>;
    const candidate = typeof person === 'string' ? byRef.get(person) : undefined;
    if (!candidate || !Array.isArray(pairs)) continue;
    const theirs = new Set(candidate.interests.map((phrase) => phrase.toLowerCase()));
    const kept = out.get(candidate.id) ?? [];
    for (const pair of pairs) {
      if (!pair || typeof pair !== 'object') continue;
      const { mine: a, theirs: b } = pair as Record<string, unknown>;
      const phrase = typeof a === 'string' ? own.get(tidy(a).toLowerCase()) : undefined;
      if (!phrase || typeof b !== 'string' || !theirs.has(tidy(b).toLowerCase()) || kept.includes(phrase)) continue;
      kept.push(phrase);
    }
    if (kept.length) out.set(candidate.id, kept);
  }
  return out;
}

/** Muse's openers for known candidates: one short line each. Returns candidate id → opener. */
export function validateOpeners(raw: unknown, candidates: Candidate[]): Map<string, string> {
  const byRef = new Map(candidates.map((candidate, index) => [candidateRef(index), candidate]));
  const out = new Map<string, string>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { person, opener } = item as Record<string, unknown>;
    const candidate = typeof person === 'string' ? byRef.get(person) : undefined;
    const text = typeof opener === 'string' ? tidy(opener).slice(0, 140).trim() : '';
    if (!candidate || text.length < 8 || out.has(candidate.id)) continue;
    out.set(candidate.id, text);
  }
  return out;
}

/** One row per candidate the viewer shares something with, from the wording match alone. */
export function basicMatches(mine: string[], candidates: Candidate[]): ({ id: string } & SharedWith)[] {
  return candidates.flatMap((candidate) => {
    const shared = sharedInterests(mine, candidate.interests);
    return shared.length ? [{ id: candidate.id, shared, opener: basicOpener(shared) }] : [];
  });
}

/** Wording matches plus Muse's validated pairs, in the order of the viewer's own list. */
export function mergeShared(mine: string[], basic: string[], muse: string[] = []): string[] {
  const keep = new Set([...basic, ...muse]);
  return mine.filter((phrase) => keep.has(phrase));
}

/**
 * Identifies the interest lists a set of matches was computed from. It is a
 * fingerprint of other people's saved interests, so it stays on the server.
 */
export function peopleKey(mine: string[], candidates: Candidate[]): string {
  const rows = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((c) => [c.id, c.interests]);
  const text = JSON.stringify([mine, rows]);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

export type SyncStep = 'idle' | 'hydrate' | 'push';
/**
 * Keeps the interests on this device and the list saved for people matching in
 * step. `saved` is undefined while matching is off, when nothing is stored. A
 * device that starts empty takes the saved list once; after that the device's own
 * list wins, and `lastSent` (the list last pushed, as JSON) stops a repeat.
 */
export function syncStep(local: string[], saved: string[] | undefined, hydrated: boolean, lastSent: string | null): SyncStep {
  if (saved === undefined) return 'idle';
  if (!hydrated && !local.length && saved.length) return 'hydrate';
  const mine = JSON.stringify(local);
  return mine === JSON.stringify(saved) || mine === lastSent ? 'idle' : 'push';
}

/**
 * The sample walkthrough has no backend, so its two fictional attendees carry
 * fictional interests and the match is the wording match, computed on the device.
 * `mine` is undefined while the person has people matching switched off.
 */
export function withSampleMatching(snapshot: Snapshot, mine: string[] | undefined): Snapshot {
  if (!mine) return snapshot;
  const me = { ...snapshot.me, interests: mine };
  if (!snapshot.event) return { ...snapshot, me };
  return {
    ...snapshot, me, matching: { source: 'basic', stale: false },
    members: snapshot.members.map((person) => {
      const theirs = person.id === me.id ? undefined : SAMPLE_PEOPLE_INTERESTS[person.id];
      if (!theirs) return person;
      const shared = sharedInterests(mine, [...theirs]);
      return { ...person, shared, ...(shared.length ? { opener: basicOpener(shared) } : {}) };
    }),
  };
}
