import type { PersonProfile, Suggestion } from './contracts';

const STOPWORDS = new Set(['about', 'with', 'that', 'this', 'from', 'into', 'their', 'your', 'what', 'more', 'less', 'over', 'very', 'just',
  'formerly', 'second', 'year', 'student', 'founder', 'designer', 'builder', 'researcher', 'organizer', 'printer', 'runs', 'tools', 'product', 'engineer']);
const MAKERS = /\b(tools?|software|engineer|developer|founder|builder|designer|product|researcher|builds?|building)\b/i;

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter(word => !STOPWORDS.has(word));
}
const first = (name: string) => name.trim().split(/\s+/)[0] || 'them';
const lower = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);
const article = (value: string) => (/^[aeiou]/i.test(value) ? 'an' : 'a');
/** First person → third person for a line quoted about someone. */
const thirdPerson = (text: string) => text.replace(/\bmy\b/gi, 'their').replace(/\bI[’']m\b/g, 'they’re').replace(/\bI\b/g, 'they').replace(/\bme\b/gi, 'them');
/** "Ceramicist, formerly a product manager" → "ceramicist". */
const headline = (occupation: string) => lower(occupation.split(/[,;·(]/)[0].trim());

/**
 * Explain, in plain language, why two people might enjoy talking. No scores,
 * no percentages: a shared interest, a professional overlap and something to
 * say first. Pure and synchronous so it works on fixtures and live profiles alike.
 */
export function buildSuggestion(me: PersonProfile | undefined, person: PersonProfile, context: { eventTitle?: string; prompt?: string } = {}): Suggestion {
  const name = first(person.name);
  const mine = new Set((me?.interests ?? []).map(i => i.toLowerCase()));
  const shared = person.interests.filter(interest => mine.has(interest.toLowerCase()));
  const myWork = new Set(tokens(me?.occupation ?? ''));
  const workOverlap = [...new Set(tokens(person.occupation))].filter(word => myWork.has(word));
  const theirHeadline = headline(person.occupation);

  const professional: string[] = [];
  if (workOverlap.length) professional.push(`You both work on ${workOverlap.slice(0, 2).join(' and ')}.`);
  else if (MAKERS.test(theirHeadline) && MAKERS.test(me?.occupation ?? '')) professional.push(`You both make things for a living. ${name} is ${article(theirHeadline)} ${theirHeadline}.`);
  else if (theirHeadline) professional.push(`${name} is ${article(theirHeadline)} ${theirHeadline}.`);
  if (person.occupation.includes(',') && professional.length < 2) {
    const rest = person.occupation.split(',').slice(1).join(',').trim();
    if (rest) professional.push(`${/^(formerly|previously|ex-)/i.test(rest) ? '' : 'Also: '}${rest.charAt(0).toUpperCase() + rest.slice(1)}.`);
  }

  const personal: string[] = [];
  if (shared.length) personal.push(`You both listed ${shared.slice(0, 2).map(lower).join(' and ')}.`);
  else if (person.interests.length) personal.push(`Outside work, ${name} is into ${person.interests.slice(0, 2).map(lower).join(' and ')}.`);

  const starters: string[] = [];
  if (shared.length) starters.push(`Ask ${name} how they got into ${lower(shared[0])}. You both did.`);
  for (const fact of person.facts) {
    const ask = fact.match(/ask me (about|how|why|what|which|where)\s+(.+?)[.!]?$/i);
    const outside = fact.match(/^outside work, i[’']m into (.+?)[.!]?$/i);
    if (ask) starters.push(`Ask ${name} ${ask[1].toLowerCase()} ${ask[2]}.`);
    else if (outside) starters.push(`${name} spends free time on ${thirdPerson(outside[1])}. Ask what that looks like.`);
    else if (starters.length < 2) starters.push(`${name} mentioned: “${fact}”`);
  }
  if (context.prompt && starters.length < 3) starters.push(`Try the host’s prompt: “${context.prompt}”`);
  if (starters.length < 2) starters.push(context.eventTitle ? `Ask what brought ${name} to ${context.eventTitle}.` : `Ask what brought ${name} here.`);
  return { person, professional: [...new Set(professional)].slice(0, 2), personal, starters: [...new Set(starters)].slice(0, 3), shared };
}

/** Rank the room by how much there is to talk about; ties keep the original order. */
export function suggestPeople(me: PersonProfile | undefined, people: PersonProfile[], context: { eventTitle?: string; prompt?: string } = {}): Suggestion[] {
  return people
    .map((person, index) => ({ index, suggestion: buildSuggestion(me, person, context) }))
    .sort((a, b) => score(b.suggestion) - score(a.suggestion) || a.index - b.index)
    .map(item => item.suggestion);
}
function score(suggestion: Suggestion): number {
  return suggestion.shared.length * 3 + (suggestion.professional[0]?.startsWith('You both') ? 2 : 0) + Math.min(2, suggestion.person.facts.length);
}
