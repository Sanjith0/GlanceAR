import type { Event } from '../domain';
import type { EventDetails } from '../services/contracts';

/** Local date arithmetic so the sample calendar always sits around "today". */
export function atLocal(dayOffset: number, hour: number, minute = 0, from = new Date()): number {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + dayOffset, hour, minute, 0, 0);
  return date.getTime();
}

export interface FixtureEvent {
  event: Event;
  details: EventDetails;
  members: string[];
  /** Attendees who turned Glance on for this event. */
  enabled: string[];
}

/**
 * Sample events. `builders` is the walkthrough event the tests rely on: exactly
 * Alex and Sam as members, both with Glance on, invitation code GL26.
 */
export function fixtureEvents(now = new Date()): FixtureEvent[] {
  return [
    {
      event: { id: 'builders', title: 'Builders, after hours', location: 'The Studio, 18th Street', inviteCode: 'GL26', hostId: 'alex' },
      details: {
        startsAt: atLocal(0, 19, 30, now), endsAt: atLocal(0, 22, 0, now), address: '3130 18th St, San Francisco', cover: 'arches', visibility: 'invite',
        description: 'A small evening for people who make things. Bring whatever you’re working on, half-finished is better.',
        purpose: 'Meet two or three people worth a second conversation, not a stack of business cards.',
        prompt: 'What did you build this month that surprised you?',
      },
      members: ['alex', 'sam'], enabled: ['alex', 'sam'],
    },
    {
      event: { id: 'salon', title: 'Slow Sunday Salon', location: 'Alley Cat Books, Mission', inviteCode: 'TEA4', hostId: 'maya' },
      details: {
        startsAt: atLocal(7, 16, 0, now), endsAt: atLocal(7, 19, 0, now), address: '3036 24th St, San Francisco', cover: 'window', visibility: 'invite',
        description: 'Readings, tea and one long table. Maya hosts; the bookshop stays open just for us. No agenda beyond good company.',
        purpose: 'Long conversations with people from outside your own field.',
        prompt: 'What’s something you learned by hand this year?',
      },
      members: ['alex', 'maya', 'priya', 'jonah', 'lin', 'theo'], enabled: ['alex', 'maya', 'priya', 'lin'],
    },
    {
      event: { id: 'demoday', title: 'Demo Day, no slides', location: 'Pier 70, Dogpatch', inviteCode: 'DEMO', hostId: 'dev' },
      details: {
        startsAt: atLocal(18, 18, 0, now), endsAt: atLocal(18, 21, 0, now), address: '420 22nd St, San Francisco', cover: 'meridian', visibility: 'open',
        description: 'Eight builders, eight working demos, zero decks. The rest of the night is for asking the people who built them anything.',
        purpose: 'Find a collaborator, a first customer, or someone who has already solved your hardest problem.',
        prompt: 'Which demo would you want to steal?',
      },
      members: ['alex', 'dev', 'lin', 'rosa', 'theo'], enabled: ['dev', 'lin'],
    },
    {
      event: { id: 'printshop', title: 'Print Shop Open Night', location: 'Delgado Print Collective, Oakland', inviteCode: 'INK9', hostId: 'rosa' },
      details: {
        startsAt: atLocal(27, 14, 0, now), endsAt: atLocal(27, 18, 0, now), address: '2306 Telegraph Ave, Oakland', cover: 'ledger', visibility: 'invite',
        description: 'The presses are on and the paper is out. Come pull a print, stay for the people.',
        purpose: 'Meet the makers, printers and organizers who keep the collective running.',
        prompt: '',
      },
      members: ['rosa', 'jonah', 'sam'], enabled: ['rosa', 'jonah'],
    },
    {
      event: { id: 'cafe', title: 'Coffee & Prototypes', location: 'Sightglass, SoMa', inviteCode: 'POUR', hostId: 'lin' },
      details: {
        startsAt: atLocal(-15, 10, 0, now), endsAt: atLocal(-15, 12, 0, now), address: '270 7th St, San Francisco', cover: 'tide', visibility: 'open',
        description: 'A Saturday morning for showing early work over a pour-over. Low stakes, high caffeine.',
        purpose: 'A gentle place to show something rough.',
        prompt: 'What are you prototyping?',
      },
      members: ['alex', 'sam', 'lin', 'dev'], enabled: ['alex', 'sam', 'lin'],
    },
  ];
}
