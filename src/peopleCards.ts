/**
 * Pure helpers for the Meta-glasses "people cards" and the attendee-list match colours.
 * No React or native imports, so the timing rules can be tested without a camera.
 */
import type { Profile } from './domain';

/** Total time someone must be looked at before their card is added. */
export const CARD_DWELL_MS = 1_000;
/** A card stays this long after the person was last seen, then it is removed. */
export const CARD_LINGER_MS = 10_000;
/** Seen this recently counts as "looking at them right now". */
export const CARD_IN_VIEW_MS = 1_500;
/** Sightings closer together than this count as one continuous look. */
const DWELL_GAP_MS = 1_000;

interface Entry { dwell: number; lastSeen: number; shownAt: number | null }

export interface PersonCard {
  id: string;
  /** When this card was (re)added; cards are listed oldest first. */
  shownAt: number;
  /** True while their face is in view right now. */
  inView: boolean;
  /** 1 while in view, then draining to 0 over the linger time. */
  remaining: number;
}

/**
 * Decides which recognized people have a card.
 *
 * - A card is added after the person has been in view for {@link CARD_DWELL_MS}
 *   in total (short gaps bridge, separate glances add up).
 * - It stays while they are in view and for {@link CARD_LINGER_MS} after they
 *   were last seen, then it goes.
 * - Someone who earned a card before gets it straight back the next time they
 *   are seen, for another linger period.
 */
export class PeopleCardTracker {
  private entries = new Map<string, Entry>();

  /** Call with the ids recognized in a camera frame (any order, repeats allowed). */
  observe(ids: string[], now: number): void {
    for (const id of new Set(ids)) {
      const entry = this.entries.get(id);
      if (!entry) {
        this.entries.set(id, { dwell: 0, lastSeen: now, shownAt: null });
        continue;
      }
      const gap = now - entry.lastSeen;
      if (entry.shownAt !== null) {
        // The card had expired: bring it back right away.
        if (gap > CARD_LINGER_MS) entry.shownAt = now;
      } else if (gap > CARD_LINGER_MS) {
        entry.dwell = 0; // a stale partial look does not count
      } else if (gap <= DWELL_GAP_MS) {
        entry.dwell += gap;
      }
      entry.lastSeen = now;
      if (entry.shownAt === null && entry.dwell >= CARD_DWELL_MS) entry.shownAt = now;
    }
    for (const [id, entry] of this.entries) {
      if (entry.shownAt === null && now - entry.lastSeen > CARD_LINGER_MS) this.entries.delete(id);
    }
  }

  /** The cards to show at `now`, oldest first. */
  cards(now: number): PersonCard[] {
    const out: PersonCard[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.shownAt === null) continue;
      const away = now - entry.lastSeen;
      if (away > CARD_LINGER_MS) continue;
      out.push({
        id, shownAt: entry.shownAt, inView: away <= CARD_IN_VIEW_MS,
        remaining: away <= CARD_IN_VIEW_MS ? 1 : Math.max(0, 1 - away / CARD_LINGER_MS),
      });
    }
    return out.sort((a, b) => a.shownAt - b.shownAt);
  }

  reset(): void { this.entries.clear(); }
}

export interface Segment { text: string; hit: boolean }

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Splits `text` so every occurrence of one of `phrases` (any case) is marked as a hit. */
export function highlight(text: string, phrases: string[]): Segment[] {
  const wanted = [...new Set(phrases.map(p => p.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!text || !wanted.length) return text ? [{ text, hit: false }] : [];
  const pattern = new RegExp(wanted.map(escapeRegex).join('|'), 'gi');
  const out: Segment[] = [];
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > at) out.push({ text: text.slice(at, start), hit: false });
    out.push({ text: match[0], hit: true });
    at = start + match[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

export type MatchTone = 'strong' | 'some' | 'none';
/** At least this many shared interests marks someone as a strong match. */
export const STRONG_MATCH_AT = 3;

/**
 * How alike you and an attendee are, from the interests you share (the list the
 * people-matching agent fills in). Undefined when either of you has matching off,
 * so nobody is called "nothing in common" without anyone having looked.
 */
export function matchTone(person: Pick<Profile, 'shared'>): MatchTone | undefined {
  const count = person.shared?.length;
  if (count === undefined) return undefined;
  return count >= STRONG_MATCH_AT ? 'strong' : count > 0 ? 'some' : 'none';
}

/** Words for each tone; colour is never the only signal. */
export function matchLabel(person: Pick<Profile, 'shared'>): string {
  const count = person.shared?.length ?? 0;
  return count === 0 ? 'Nothing in common yet' : `${count} in common`;
}
