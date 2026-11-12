/**
 * Events (Discover) mode: the sample catalog and the pure matching/validation
 * helpers shared by the app and the Convex backend. No React or native imports.
 *
 * Every event here is fictional sample data for the concept demo. Hosts and
 * private venues are invented; only neighbourhoods and public places are real.
 */
export const DISCOVER_AREA = 'Dallas–Fort Worth';
export const DISCOVER_CATEGORIES = [
  'Tech', 'Music', 'Food & drink', 'Fitness & outdoors', 'Arts', 'Games', 'Wellness', 'Community',
] as const;
export type DiscoverCategory = typeof DISCOVER_CATEGORIES[number];
export type CoverIcon =
  | 'cpu' | 'eye' | 'trending-up' | 'music' | 'headphones' | 'map-pin' | 'coffee' | 'sunrise' | 'triangle'
  | 'anchor' | 'camera' | 'image' | 'mic' | 'grid' | 'monitor' | 'sun' | 'feather' | 'shopping-bag' | 'target' | 'truck';

export interface DiscoverEvent {
  id: string;
  title: string;
  category: DiscoverCategory;
  blurb: string;
  host: string;
  venue: string;
  area: string;
  /** 0 = Sunday. The date is the next occurrence of this weekday, plus `week` weeks. */
  weekday: number;
  week: 0 | 1;
  time: string;
  /** Sample attendance, not a live count. */
  going: number;
  price: string;
  tags: string[];
  cover: { from: string; to: string; icon: CoverIcon };
}

const event = (
  id: string, title: string, category: DiscoverCategory, blurb: string, host: string, venue: string, area: string,
  weekday: number, week: 0 | 1, time: string, going: number, price: string, tags: string[], cover: DiscoverEvent['cover'],
): DiscoverEvent => ({ id, title, category, blurb, host, venue, area, weekday, week, time, going, price, tags, cover });

export const DISCOVER_EVENTS: readonly DiscoverEvent[] = [
  event('ai-builders-demo-night', 'AI Builders Demo Night', 'Tech',
    'Six five-minute demos from people shipping with LLMs, agents and on-device models, then open tables to try what they built.',
    'DFW AI Builders', 'The Foundry Loft', 'Downtown Dallas', 4, 0, '6:30 PM', 184, 'Free',
    ['ai', 'machine learning', 'llm', 'agents', 'startups', 'coding', 'demos', 'hackathons'],
    { from: '#1D4ED8', to: '#7C3AED', icon: 'cpu' }),
  event('smart-glasses-ar-hack-evening', 'Smart Glasses & AR Hack Evening', 'Tech',
    'Bring a headset or smart glasses, or borrow one. Pair up and prototype something you can wear by the end of the night.',
    'Wearables Guild', 'Makerspace North', 'Richardson', 6, 0, '5:00 PM', 96, 'Free',
    ['ar', 'vr', 'smart glasses', 'wearables', 'computer vision', 'hardware', 'gadgets', 'coding'],
    { from: '#0F766E', to: '#2563EB', icon: 'eye' }),
  event('growth-teardown-breakfast', 'Growth Teardown Breakfast', 'Tech',
    'Three onboarding flows pulled apart over tacos and coffee. Bring a product you want honest feedback on.',
    'Uptown Product Club', 'Second Floor Studio', 'Uptown Dallas', 3, 1, '8:00 AM', 58, '$10',
    ['growth', 'product', 'startups', 'marketing', 'onboarding', 'saas', 'founders', 'entrepreneurship'],
    { from: '#B45309', to: '#DC2626', icon: 'trending-up' }),
  event('deep-ellum-indie-night', 'Deep Ellum Indie Night', 'Music',
    'Four local bands, one small room. Doors at seven, first set at eight, and the patio stays open late.',
    'Elm Street Sessions', 'The Listening Room', 'Deep Ellum', 5, 0, '7:00 PM', 240, '$15',
    ['live music', 'indie', 'concerts', 'bands', 'guitar', 'rock', 'vinyl'],
    { from: '#BE185D', to: '#7C3AED', icon: 'music' }),
  event('rooftop-house-sunset', 'Rooftop House Sunset Set', 'Music',
    'Local DJs play melodic house from golden hour until the skyline lights up.',
    'Skyline Sound', 'Rooftop Twenty-One', 'Downtown Dallas', 6, 0, '6:00 PM', 310, '$20',
    ['house music', 'dj', 'edm', 'electronic', 'dancing', 'nightlife', 'rooftop'],
    { from: '#EA580C', to: '#DB2777', icon: 'headphones' }),
  event('bishop-arts-taco-crawl', 'Bishop Arts Taco Crawl', 'Food & drink',
    'Five taquerias in ninety minutes with a guide who knows which salsa to ask for.',
    'Eat the Block', 'Bishop Arts District', 'Oak Cliff', 0, 0, '12:00 PM', 72, '$35',
    ['tacos', 'food', 'street food', 'restaurants', 'mexican food', 'foodie', 'cooking'],
    { from: '#D97706', to: '#DC2626', icon: 'map-pin' }),
  event('specialty-coffee-cupping', 'Specialty Coffee Cupping', 'Food & drink',
    'Taste six single-origin coffees side by side and learn to describe what you like about them.',
    'Slow Pour Roasters', 'Slow Pour Roastery', 'Design District', 6, 0, '10:00 AM', 40, '$18',
    ['coffee', 'specialty coffee', 'espresso', 'cafes', 'latte art', 'baking', 'tasting'],
    { from: '#78350F', to: '#B45309', icon: 'coffee' }),
  event('katy-trail-sunrise-run', 'Katy Trail Sunrise Run Club', 'Fitness & outdoors',
    'An easy conversational 5K at sunrise, all paces welcome, with breakfast tacos after.',
    'Sunrise Striders', 'Katy Trail, Knox Street entrance', 'Uptown Dallas', 6, 0, '6:30 AM', 130, 'Free',
    ['running', 'fitness', '5k', 'marathon', 'workout', 'jogging', 'cardio'],
    { from: '#C2410C', to: '#F59E0B', icon: 'sunrise' }),
  event('beginner-bouldering-social', 'Beginner Bouldering Social', 'Fitness & outdoors',
    'Shoes and chalk included. Staff set easy problems and pair first-timers with regulars.',
    'Chalk Social', 'Summit Bouldering Hall', 'Design District', 2, 1, '7:00 PM', 64, '$22',
    ['climbing', 'bouldering', 'rock climbing', 'fitness', 'gym', 'outdoors', 'adventure'],
    { from: '#0E7490', to: '#16A34A', icon: 'triangle' }),
  event('white-rock-paddle-picnic', 'White Rock Lake Paddle & Picnic', 'Fitness & outdoors',
    'Kayaks and paddleboards for a relaxed lap of the lake, then a shared picnic on the lawn.',
    'Lake Days DFW', 'White Rock Lake boathouse', 'East Dallas', 0, 0, '9:00 AM', 88, '$25',
    ['kayaking', 'paddleboarding', 'outdoors', 'hiking', 'nature', 'lake', 'camping'],
    { from: '#0369A1', to: '#0D9488', icon: 'anchor' }),
  event('film-photo-walk', '35mm Film Photo Walk', 'Arts',
    'Shoot one roll through the murals with other film people. Loaner cameras available.',
    'Grain Club', 'Mural Alley', 'Deep Ellum', 0, 0, '4:00 PM', 46, 'Free',
    ['photography', 'film photography', 'cameras', 'street photography', 'art', 'murals'],
    { from: '#374151', to: '#9333EA', icon: 'camera' }),
  event('design-district-gallery-night', 'Design District Gallery Night', 'Arts',
    'Twelve galleries stay open late with new shows, artists on hand and a free shuttle between stops.',
    'Dallas Art Walk', 'Dragon Street galleries', 'Design District', 5, 1, '6:00 PM', 205, 'Free',
    ['art', 'galleries', 'design', 'painting', 'museums', 'illustration', 'sculpture'],
    { from: '#9D174D', to: '#EA580C', icon: 'image' }),
  event('improv-open-mic', 'Improv & Comedy Open Mic', 'Arts',
    'Sign up for five minutes or just watch. Friendly crowd, and first-timers get the loudest applause.',
    'Yes And Dallas', 'The Back Room Theater', 'Lower Greenville', 4, 0, '8:00 PM', 77, '$8',
    ['comedy', 'improv', 'stand-up', 'theater', 'sketch', 'memes'],
    { from: '#6D28D9', to: '#DB2777', icon: 'mic' }),
  event('board-game-league-night', 'Board Game Café League Night', 'Games',
    'Drop-in tables for strategy games, party games and a teach-and-play corner for newcomers.',
    'Meeple Collective', 'Dice & Slice Café', 'Plano', 3, 0, '6:30 PM', 52, 'Free',
    ['board games', 'tabletop', 'strategy games', 'chess', 'dungeons & dragons', 'card games', 'puzzles'],
    { from: '#15803D', to: '#0E7490', icon: 'grid' }),
  event('fighting-game-weeklies', 'Fighting Game Weeklies', 'Games',
    'Bracket play and casual setups for Smash, Street Fighter and Tekken. Bring a controller.',
    'DFW FGC', 'Player Two Arcade', 'Carrollton', 2, 0, '7:00 PM', 110, '$5',
    ['gaming', 'video games', 'esports', 'smash bros', 'fighting games', 'streaming', 'anime'],
    { from: '#4338CA', to: '#DC2626', icon: 'monitor' }),
  event('sunset-yoga-park', 'Sunset Yoga in the Park', 'Wellness',
    'A slow all-levels flow on the lawn as the sun goes down. Bring a mat and water.',
    'Still Water Yoga', 'Great Lawn, Klyde Warren Park', 'Downtown Dallas', 1, 0, '6:00 PM', 150, 'Free',
    ['yoga', 'meditation', 'wellness', 'mindfulness', 'stretching', 'pilates', 'self care'],
    { from: '#7E22CE', to: '#EA580C', icon: 'sun' }),
  event('community-garden-build-day', 'Community Garden Build Day', 'Community',
    'Build raised beds and plant fall greens for a neighbourhood pantry. Tools and lunch provided.',
    'Oak Cliff Grows', 'Tenth Street Garden', 'Oak Cliff', 6, 1, '9:00 AM', 61, 'Free',
    ['volunteering', 'gardening', 'community', 'sustainability', 'plants', 'diy', 'woodworking'],
    { from: '#166534', to: '#65A30D', icon: 'feather' }),
  event('south-asian-night-market', 'South Asian Night Market', 'Community',
    'Chaat, dosa and chai stalls, a Bollywood dance set and local makers selling late into the night.',
    'Desi Collective DFW', 'Market Square Plaza', 'Irving', 6, 1, '5:00 PM', 420, 'Free',
    ['indian food', 'bollywood', 'street food', 'culture', 'night market', 'festivals', 'dance', 'chai'],
    { from: '#C2410C', to: '#BE185D', icon: 'shopping-bag' }),
  event('sunday-pickup-basketball', 'Sunday Pickup Basketball', 'Fitness & outdoors',
    'Full-court runs sorted by skill level. Show up, shoot for teams, play to eleven.',
    'Hoop Session', 'Greenline Park courts', 'East Dallas', 0, 0, '3:00 PM', 34, 'Free',
    ['basketball', 'sports', 'nba', 'pickup games', 'fitness'],
    { from: '#B91C1C', to: '#EA580C', icon: 'target' }),
  event('cars-and-coffee-meet', 'Cars & Coffee Morning Meet', 'Community',
    'Classics, tuners and EVs parked side by side. Owners love questions, so ask them.',
    'Lone Star Drivers', 'Garage Row lot', 'Frisco', 0, 1, '8:00 AM', 275, 'Free',
    ['cars', 'automotive', 'racing', 'formula 1', 'detailing', 'motorcycles', 'ev'],
    { from: '#1F2937', to: '#B91C1C', icon: 'truck' }),
];

const byId = new Map(DISCOVER_EVENTS.map((e) => [e.id, e]));
export const discoverEvent = (id: string | undefined): DiscoverEvent | undefined => (id ? byId.get(id) : undefined);

/** The event's date: the next occurrence of its weekday (today counts), plus `week` weeks. */
export function eventDate(e: Pick<DiscoverEvent, 'weekday' | 'week'>, now: Date = new Date()): Date {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  date.setDate(date.getDate() + ((e.weekday - date.getDay() + 7) % 7) + e.week * 7);
  return date;
}
export function eventWhen(e: DiscoverEvent, now: Date = new Date()): string {
  const date = eventDate(e, now);
  const days = Math.round((date.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow'
    : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day} · ${e.time}`;
}
const minutes = (time: string) => {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time);
  return match ? (Number(match[1]) % 12 + (match[3] === 'PM' ? 12 : 0)) * 60 + Number(match[2]) : 0;
};
/** Soonest first. */
export function upcoming(now: Date = new Date()): DiscoverEvent[] {
  return [...DISCOVER_EVENTS].sort((a, b) =>
    eventDate(a, now).getTime() - eventDate(b, now).getTime() || minutes(a.time) - minutes(b.time));
}

/* ---------- signals ---------- */

export interface Signals {
  /** Short interest phrases the person reviewed and chose to share. */
  interests: string[];
  /** Their one-line Glance introduction, or '' when they left it out. */
  intro: string;
  /** One sentence describing what they have been watching, when a screenshot was read. */
  summary: string;
}
export interface DiscoverPick { eventId: string; score: number; reason: string }
export interface Recommendation {
  picks: DiscoverPick[];
  /** 'muse' only when Meta's Muse Spark produced these picks; 'basic' is the keyword match below. */
  source: 'muse' | 'basic';
  model?: string;
  /** Why this is a basic match (sample mode, missing key, provider failure). */
  notice?: string;
}
export interface TasteRead { interests: string[]; summary: string }

export const MAX_INTERESTS = 24;
export const SAMPLE_SIGNALS: TasteRead = {
  interests: ['bouldering', 'specialty coffee', 'film photography', 'ai agents', 'indie music', 'street food'],
  summary: 'Sample signals: climbing clips, espresso tutorials, film cameras and indie live sets.',
};

const tidy = (value: string) => value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Trims, bounds and de-duplicates interest phrases from any source (typed, sample or model output). */
export function cleanInterests(raw: unknown, limit: number = MAX_INTERESTS): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const value = tidy(item).replace(/^#+/, '').replace(/[^\p{L}\p{N} &'’+./-]/gu, '').trim().slice(0, 40).trim();
    const key = value.toLowerCase();
    if (value.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}
/** "climbing, espresso; live music" → ['climbing', 'espresso', 'live music']. */
export const splitInterests = (text: string): string[] => cleanInterests(text.split(/[,;\n]+/));

/** Keeps only picks for real catalog events, once each, with a bounded score and reason. */
export function validatePicks(raw: unknown, limit = 6): DiscoverPick[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const picks: DiscoverPick[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { eventId, score, reason } = item as Record<string, unknown>;
    if (typeof eventId !== 'string' || !byId.has(eventId) || seen.has(eventId)) continue;
    const text = typeof reason === 'string' ? tidy(reason).slice(0, 180) : '';
    if (!text || typeof score !== 'number' || !Number.isFinite(score)) continue;
    seen.add(eventId);
    picks.push({ eventId, score: Math.max(0, Math.min(100, Math.round(score))), reason: text });
    if (picks.length >= limit) break;
  }
  return picks;
}

/* ---------- basic keyword match (sample mode and provider fallback) ---------- */

const STOP = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'at', 'for', 'to', 'with', 'my', 'i', 'me', 'is', 'am',
  'who', 'that', 'into', 'about', 'by', 'or', 'from', 'it', 'be', 'are', 'love', 'like', 'fan', 'things',
  // Too generic to link a person to an event on their own.
  'night', 'day', 'evening', 'live', 'social', 'club', 'event', 'events', 'weekly', 'local', 'new', 'open', 'meetup',
  'video', 'videos', 'clip', 'clips', 'reel', 'reels', 'content', 'tips', 'stuff']);
const stem = (word: string) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w)).map(stem);
/** True when `inner` appears as consecutive whole words inside `outer` ("ar" never matches "art"). */
const hasSequence = (outer: string[], inner: string[]) => inner.length > 0 && outer.some((_, start) =>
  inner.every((word, offset) => outer[start + offset] === word));

const indexed = DISCOVER_EVENTS.map((e) => ({
  event: e,
  tags: e.tags.map(words),
  tagWords: new Set(e.tags.flatMap(words)),
  textWords: new Set(words(`${e.title} ${e.category} ${e.blurb}`)),
}));
const strength = (entry: typeof indexed[number], phrase: string[]): number => {
  if (!phrase.length) return 0;
  if (entry.tags.some((tag) => hasSequence(tag, phrase) || hasSequence(phrase, tag))) return 3;
  if (phrase.every((word) => entry.tagWords.has(word))) return 2;
  // One shared word ("street" in street food and street photography) is only a loose link.
  return phrase.some((word) => entry.tagWords.has(word) || entry.textWords.has(word)) ? 1 : 0;
};

/**
 * Deterministic stand-in for Muse: whole-word overlap between the person's signals
 * and each event's tags and description. Used in the sample walkthrough and when
 * the provider fails, and always labelled as a basic match.
 */
export function basicRecommend(signals: Signals, limit = 6): Recommendation {
  const interests = cleanInterests(signals.interests);
  const introParts = signals.intro.split(/[·,;|/]+|\band\b/i).map(tidy).filter(Boolean);
  const scored = indexed.map((entry) => {
    const hits = interests.map((interest) => ({ interest, weight: strength(entry, words(interest)) })).filter((h) => h.weight > 0);
    const introWeight = Math.max(0, ...introParts.map((part) => strength(entry, words(part))));
    // Interests the person chose to share count double what their intro implies.
    const raw = hits.reduce((sum, h) => sum + h.weight, 0) + (introWeight >= 2 ? introWeight / 2 : 0);
    const named = hits.filter((h) => h.weight >= 2).sort((a, b) => b.weight - a.weight).slice(0, 2).map((h) => h.interest);
    const reason = named.length
      ? `Matches your interest in ${named.join(' and ')}.`
      : introWeight >= 2 ? 'Lines up with your Glance intro.' : `Loosely related to ${hits[0]?.interest ?? 'your signals'}.`;
    return { event: entry.event, raw, strong: named.length > 0 || introWeight >= 2, reason, lead: named[0] ?? hits[0]?.interest ?? '' };
  }).filter((row) => row.raw > 0)
    .sort((a, b) => Number(b.strong) - Number(a.strong) || b.raw - a.raw || b.event.going - a.event.going);
  const strong = scored.filter((row) => row.strong);
  const pool = strong.length >= 3 ? strong : scored;
  // Give every interest its best event before any interest gets a second one.
  const covered = new Set<string>();
  const firsts = pool.filter((row) => !covered.has(row.lead) && Boolean(covered.add(row.lead)));
  const chosen = [...firsts, ...pool.filter((row) => !firsts.includes(row))].slice(0, limit).sort((a, b) => pool.indexOf(a) - pool.indexOf(b));
  return {
    source: 'basic',
    picks: chosen.map((row) => ({ eventId: row.event.id, score: Math.min(97, Math.round((row.strong ? 58 : 40) + row.raw * 7)), reason: row.reason })),
  };
}

/** Identifies the exact signals a set of picks was computed for. */
export const signalsKey = (intro: string, interests: string[]): string => JSON.stringify([tidy(intro), interests]);
