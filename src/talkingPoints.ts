import type { Profile } from './domain';

const STOPWORDS = new Set(['about', 'with', 'that', 'this', 'from', 'into', 'their', 'your', 'what', 'more', 'less', 'over', 'very', 'just']);

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z-]{3,}/g)?.filter(w => !STOPWORDS.has(w)) ?? [];
}

const list = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * Up to three conversation starters. When people matching found interests the two
 * of you share, those and their opener lead; the rest come from both one-line
 * introductions, with no AI and no network.
 */
export function talkingPoints(
  me: Pick<Profile, 'role'> | undefined, them: Pick<Profile, 'role' | 'shared' | 'opener'>, eventTitle?: string,
): string[] {
  const points: string[] = [];
  if (them.shared?.length) {
    points.push(`You’re both into ${list(them.shared.slice(0, 3))}`);
    if (them.opener) points.push(them.opener);
  }
  const mine = new Set(words(me?.role ?? ''));
  const shared = [...new Set(words(them.role))].filter(w => mine.has(w));
  if (shared.length) points.push(`You both mention ${shared.slice(0, 2).join(' and ')}`);
  for (const part of them.role.split(/[·|,;/]|\s+and\s+/).map(p => p.trim()).filter(Boolean).slice(0, 2)) {
    if (/^[A-Za-z-]+$/.test(part)) {
      const role = part.toLowerCase();
      points.push(`Ask what they’re working on as ${/^[aeiou]/.test(role) ? 'an' : 'a'} ${role}`);
    } else points.push(`Ask about ${part}`);
  }
  points.push(eventTitle ? `Ask what brought them to ${eventTitle}` : 'Ask what brought them here');
  return [...new Set(points)].slice(0, 3);
}
