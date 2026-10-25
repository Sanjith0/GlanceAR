import type { Profile, Recap } from '../domain';
import type { ConnectionRecord, LinkedInImport } from '../services/contracts';
import { atLocal } from './events';

/** The repository's scripted sample recap, kept word for word. */
export const sampleRecap: Recap = {
  summary: 'You connected over making technology feel more human. Alex is building tools that help people stay present, while Sam is exploring more thoughtful ways to capture creative ideas. You both want useful AI that stays out of the way.',
  topics: ['Human-centered AI', 'Creative collaboration', 'Designing for presence'],
  nextSteps: ['Compare your early prototypes over coffee.', 'Share one example of an AI interaction that feels natural.'],
  source: 'sample',
};

/**
 * The scripted recap a sample conversation receives when it finishes. Alex and
 * Sam keep the original text; any other pair gets a short scripted recap built
 * from their one-line introductions. Always labelled `sample`, never a transcription.
 */
export function scriptedRecap(participants: Pick<Profile, 'id' | 'name' | 'role'>[]): Recap {
  const ids = participants.map(p => p.id);
  if (ids.includes('alex') && ids.includes('sam')) return sampleRecap;
  const [a, b] = participants;
  const first = (name: string) => name.split(' ')[0];
  const intro = (role: string) => {
    const head = role.split(/[,;·(]/)[0].trim();
    return /^[A-Z][a-z]/.test(head) ? head.charAt(0).toLowerCase() + head.slice(1) : head;
  };
  if (!a || !b) return { ...sampleRecap, source: 'sample' };
  return {
    summary: `You compared notes on what each of you is working on. ${first(a.name)} talked about life as ${/^[aeiou]/.test(intro(a.role)) ? 'an' : 'a'} ${intro(a.role) || 'builder'}, ${first(b.name)} about being ${/^[aeiou]/.test(intro(b.role)) ? 'an' : 'a'} ${intro(b.role) || 'maker'}, and you found more overlap than either of you expected.`,
    topics: [intro(a.role) || 'Work', intro(b.role) || 'Projects', 'What to try next'].map(t => t.charAt(0).toUpperCase() + t.slice(1)),
    nextSteps: [`Send ${first(b.name)} the thing you mentioned.`, 'Pick a date for the follow-up coffee.'],
    source: 'sample',
  };
}

export const linRecap: Recap = {
  summary: 'You and Lin compared notes on why speech models fall apart in loud rooms. Lin is collecting recordings from real gatherings; you offered to share the consent flow you designed for recording with permission.',
  topics: ['Audio in noisy rooms', 'Consent-first recording', 'Go openings'],
  nextSteps: ['Send Lin the consent flow write-up.', 'Play a game of Go at the next meetup.'],
  source: 'sample',
};

/** Remembered people the signed-in sample account already has. */
export function fixtureConnections(now = new Date()): ConnectionRecord[] {
  const met = atLocal(-15, 11, 20, now);
  return [
    {
      id: 'connection-sam-cafe', personId: 'sam', eventId: 'cafe', connectedAt: met, recap: sampleRecap, origin: 'sample', bookmarked: true,
      note: 'Sam offered to send the Figma plugin that exports type specimens. Follow up before Builders.',
      messages: [
        { id: 'm-sam-1', conversationId: 'connection-sam-cafe', senderId: 'sam', text: 'Great meeting you. The plugin link is coming once I clean up the README.', createdAt: met + 3 * 3_600_000 },
        { id: 'm-sam-2', conversationId: 'connection-sam-cafe', senderId: 'alex', text: 'No rush. I want to see the ceramics studio sometime too.', createdAt: met + 5 * 3_600_000 },
      ],
    },
    {
      id: 'connection-lin-cafe', personId: 'lin', eventId: 'cafe', connectedAt: met + 40 * 60_000, recap: linRecap, origin: 'sample', bookmarked: false,
      note: '',
      messages: [
        { id: 'm-lin-1', conversationId: 'connection-lin-cafe', senderId: 'lin', text: 'Here is the paper I mentioned on microphone arrays at parties. Loud rooms are a different planet.', createdAt: met + 26 * 3_600_000 },
      ],
    },
  ];
}

/** Clearly identified sample LinkedIn result; no network or OAuth is involved. */
export const sampleLinkedInImport: LinkedInImport = {
  name: 'Alex Chen',
  headline: 'Builder · human-centered AI',
  occupation: 'Builder, human-centered AI',
  interests: ['Human-centered AI', 'Hackathons', 'Trail running'],
  facts: ['Previously shipped on-device ML features for a photo app.', 'Volunteer mentor at a weekend coding club.'],
  sample: true,
};
