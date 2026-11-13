import { describe, expect, it } from 'vitest';
import {
  CARD_DWELL_MS, CARD_IN_VIEW_MS, CARD_LINGER_MS, PeopleCardTracker, highlight, matchLabel, matchTone,
} from '../src/peopleCards';
import { commonTraits, talkingPoints } from '../src/talkingPoints';

/** Feeds `id` into the tracker every `step` ms from `from` to `to`, inclusive. */
function look(tracker: PeopleCardTracker, id: string, from: number, to: number, step = 200) {
  for (let t = from; t <= to; t += step) tracker.observe([id], t);
}
const ids = (tracker: PeopleCardTracker, now: number) => tracker.cards(now).map(card => card.id);

describe('people cards timing', () => {
  it('adds a card only after about a second of looking', () => {
    const tracker = new PeopleCardTracker();
    look(tracker, 'a', 0, 600);
    expect(ids(tracker, 600)).toEqual([]);
    look(tracker, 'a', 800, 1_000);
    expect(ids(tracker, 1_000)).toEqual(['a']);
    expect(CARD_DWELL_MS).toBe(1_000);
  });

  it('adds up separate short looks, bridging only brief gaps', () => {
    const tracker = new PeopleCardTracker();
    look(tracker, 'a', 0, 600);            // 0.6 s
    look(tracker, 'a', 3_000, 3_200);      // a new glance: the gap itself does not count
    expect(ids(tracker, 3_200)).toEqual([]); // 0.8 s in total so far
    look(tracker, 'a', 3_400, 3_600);
    expect(ids(tracker, 3_600)).toEqual(['a']);
  });

  it('forgets a glance that was too long ago to add up', () => {
    const tracker = new PeopleCardTracker();
    look(tracker, 'a', 0, 800);
    look(tracker, 'a', 30_000, 30_400); // far later: starts from zero
    expect(ids(tracker, 30_400)).toEqual([]);
  });

  it('keeps the card for ten seconds after they leave view, then removes it', () => {
    const tracker = new PeopleCardTracker();
    look(tracker, 'a', 0, 1_200);
    expect(ids(tracker, 1_200 + CARD_LINGER_MS)).toEqual(['a']);
    expect(ids(tracker, 1_200 + CARD_LINGER_MS + 1)).toEqual([]);
  });

  it('flags whether they are in view right now and drains the bar once they are not', () => {
    const tracker = new PeopleCardTracker();
    look(tracker, 'a', 0, 1_200);
    expect(tracker.cards(1_300)[0]).toMatchObject({ inView: true, remaining: 1 });
    const later = tracker.cards(1_200 + CARD_IN_VIEW_MS + 2_000)[0]!;
    expect(later.inView).toBe(false);
    expect(later.remaining).toBeGreaterThan(0);
    expect(later.remaining).toBeLessThan(1);
  });

  it('brings the card straight back when they show up again after it expired', () => {
    const tracker = new PeopleCardTracker();
    look(tracker, 'a', 0, 1_200);
    expect(ids(tracker, 20_000)).toEqual([]);
    tracker.observe(['a'], 20_000);
    expect(ids(tracker, 20_000)).toEqual(['a']);
    expect(ids(tracker, 20_000 + CARD_LINGER_MS)).toEqual(['a']);
    expect(ids(tracker, 20_000 + CARD_LINGER_MS + 1)).toEqual([]);
  });

  it('does not restart the linger while a card is still showing', () => {
    const tracker = new PeopleCardTracker();
    look(tracker, 'a', 0, 1_200);
    const first = tracker.cards(1_200)[0]!.shownAt;
    tracker.observe(['a'], 6_000); // back within the ten seconds
    expect(tracker.cards(6_000)[0]!.shownAt).toBe(first);
  });

  it('tracks several people and lists them in the order their cards were added', () => {
    const tracker = new PeopleCardTracker();
    look(tracker, 'a', 0, 1_200);
    for (let t = 1_400; t <= 3_000; t += 200) tracker.observe(['a', 'b', 'c'], t);
    expect(ids(tracker, 3_000)).toEqual(['a', 'b', 'c']);
  });

  it('counts a face repeated in one frame once', () => {
    const tracker = new PeopleCardTracker();
    for (let t = 0; t <= 600; t += 200) tracker.observe(['a', 'a', 'a'], t);
    expect(ids(tracker, 600)).toEqual([]);
  });

  it('reset clears every card', () => {
    const tracker = new PeopleCardTracker();
    look(tracker, 'a', 0, 1_200);
    tracker.reset();
    expect(ids(tracker, 1_200)).toEqual([]);
  });
});

describe('highlighting what you have in common', () => {
  it('marks every occurrence, any case, keeping the original text', () => {
    expect(highlight('What got you into F1? I love f1 too.', ['F1'])).toEqual([
      { text: 'What got you into ', hit: false }, { text: 'F1', hit: true },
      { text: '? I love ', hit: false }, { text: 'f1', hit: true }, { text: ' too.', hit: false },
    ]);
  });

  it('prefers the longer phrase and handles regex characters', () => {
    expect(highlight('Into c++ and coffee roasting', ['coffee', 'coffee roasting', 'c++'])).toEqual([
      { text: 'Into ', hit: false }, { text: 'c++', hit: true }, { text: ' and ', hit: false },
      { text: 'coffee roasting', hit: true },
    ]);
  });

  it('returns the text untouched with nothing to mark', () => {
    expect(highlight('Hello there', [])).toEqual([{ text: 'Hello there', hit: false }]);
    expect(highlight('', ['x'])).toEqual([]);
  });

  it('pulls shared interests and role words out of a pair of people', () => {
    const me = { role: 'Product designer, Austin' };
    const them = { role: 'Designer building robotics', shared: ['marvel movies', 'F1'] };
    expect(commonTraits(me, them)).toEqual(['marvel movies', 'F1', 'designer']);
    const lines = talkingPoints(me, { ...them, opener: 'What got you into F1?' }, 'Austin Networking Night');
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines[0]).toContain('marvel movies');
    expect(highlight(lines[0]!, commonTraits(me, them)).some(part => part.hit)).toBe(true);
  });
});

describe('attendee match colours', () => {
  it('is green for three or more shared interests, orange for one or two, red for none', () => {
    expect(matchTone({ shared: ['marvel', 'cars', 'f1'] })).toBe('strong');
    expect(matchTone({ shared: ['marvel', 'cars', 'f1', 'coffee'] })).toBe('strong');
    expect(matchTone({ shared: ['marvel'] })).toBe('some');
    expect(matchTone({ shared: ['marvel', 'cars'] })).toBe('some');
    expect(matchTone({ shared: [] })).toBe('none');
  });

  it('shows no colour when matching is off for either of you', () => {
    expect(matchTone({})).toBeUndefined();
  });

  it('says it in words too', () => {
    expect(matchLabel({ shared: ['a', 'b'] })).toBe('2 in common');
    expect(matchLabel({ shared: [] })).toBe('Nothing in common yet');
  });
});

describe('card countdown label', () => {
  it('counts whole seconds left of the ten', async () => {
    const { secondsLeft } = await import('../src/peopleCards');
    expect(secondsLeft(1)).toBe(10);
    expect(secondsLeft(0.75)).toBe(8);
    expect(secondsLeft(0.01)).toBe(1);
    expect(secondsLeft(0)).toBe(0);
    expect(secondsLeft(-1)).toBe(0);
    expect(secondsLeft(2)).toBe(10);
  });
});
