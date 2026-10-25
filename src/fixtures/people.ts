import portraits from '../../assets/demo-portraits.json';
import type { Profile } from '../domain';
import type { PersonDetails } from '../services/contracts';

/**
 * Fictional attendees. Alex and Sam carry the repository's two AI-generated
 * sample portraits; everyone else is drawn as a monogram arch. `role` is the
 * backend's one-line introduction and doubles as the occupation.
 */
export const fixturePeople: Profile[] = [
  { id: 'alex', name: 'Alex Chen', role: 'Builder · human-centered AI', photoUrl: portraits.alex },
  { id: 'sam', name: 'Sam Rivera', role: 'Designer · creative tools', photoUrl: portraits.sam },
  { id: 'maya', name: 'Maya Okafor', role: 'Ceramicist, formerly a product manager', photoUrl: '' },
  { id: 'dev', name: 'Dev Patel', role: 'Founder, tools for touring musicians', photoUrl: '' },
  { id: 'priya', name: 'Priya Natarajan', role: 'Second-year CS student at Berkeley', photoUrl: '' },
  { id: 'jonah', name: 'Jonah Weiss', role: 'Letterpress printer', photoUrl: '' },
  { id: 'lin', name: 'Lin Zhao', role: 'Researcher, speech and audio models', photoUrl: '' },
  { id: 'rosa', name: 'Rosa Delgado', role: 'Organizer, runs a print shop collective', photoUrl: '' },
  { id: 'theo', name: 'Theo Lindqvist', role: 'Product designer, climate fintech', photoUrl: '' },
];

export const fixtureDetails: Record<string, PersonDetails> = {
  alex: {
    occupation: 'Builder, human-centered AI',
    interests: ['Trail running', 'Film photography', 'Dumplings from scratch', 'Go (the board game)'],
    facts: ['Outside work, I’m into early-morning trail runs on Mount Tam.', 'Ask me about the 1970s film camera I rebuilt.'],
    email: '',
    phone: '',
  },
  sam: {
    occupation: 'Designer, creative tools',
    interests: ['Ceramics', 'Modular synths', 'Bike touring', 'Typography'],
    facts: ['Ask me about the weekend ceramics studio I share in Oakland.', 'Currently obsessed with typefaces from the 1970s.'],
  },
  maya: {
    occupation: 'Ceramicist, formerly a product manager',
    interests: ['Ceramics', 'Slow food', 'Jazz on vinyl', 'Urban gardening'],
    facts: ['I left product management to open a studio; ask me how it’s really going.', 'Built my kiln from scrap. It mostly works.'],
  },
  dev: {
    occupation: 'Founder, tools for touring musicians',
    interests: ['Guitar', 'Modular synths', 'Trail running', 'Science fiction'],
    facts: ['Building software for bands who tour in vans.', 'Ask me about the worst show I ever played.'],
  },
  priya: {
    occupation: 'Second-year CS student at Berkeley',
    interests: ['Competitive programming', 'Film photography', 'Dumplings from scratch', 'Climbing'],
    facts: ['Ask me about the hackathon where we shipped nothing and learned everything.', 'Looking for a summer internship on a small team.'],
  },
  jonah: {
    occupation: 'Letterpress printer',
    interests: ['Typography', 'Bike touring', 'Woodworking'],
    facts: ['I print on a 1911 Chandler & Price. Ask me about ink.', 'Riding to Portland in May if anyone wants in.'],
  },
  lin: {
    occupation: 'Researcher, speech and audio models',
    interests: ['Jazz on vinyl', 'Go (the board game)', 'Bread baking'],
    facts: ['Outside work, I’m into losing at Go to people half my age.', 'Ask me why most speech datasets sound nothing like a party.'],
  },
  rosa: {
    occupation: 'Organizer, runs a print shop collective',
    interests: ['Urban gardening', 'Salsa dancing', 'Woodworking'],
    facts: ['We turned the shop into a neighborhood library on Sundays. Ask me how.'],
  },
  theo: {
    occupation: 'Product designer, climate fintech',
    interests: ['Sailing', 'Typography', 'Climbing'],
    facts: ['Spent last summer on a boat with bad wifi. Highly recommend.'],
  },
};
