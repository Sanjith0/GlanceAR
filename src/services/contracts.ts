/**
 * Frontend service contracts.
 *
 * `domain.ts` holds the wire types the Convex backend already serves (Profile,
 * Event, Conversation, GlanceDataClient). The types here describe what the
 * redesigned screens need beyond that: richer profiles, invitation details,
 * RSVPs, recognition results and remembered connections. Today a fixture-backed
 * mock implements each adapter; the real service replaces the adapter, not the
 * screens. See docs/FRONTEND-HANDOFF.md for the integration seams.
 */
import type { ChatMessage, Event, Profile, Recap } from '../domain';
import type { CoverTheme } from '../ui/EventCover';
import type { FaceAngle } from '../ui/Arch';

/** Human details the backend profile does not store yet (occupation lives in `Profile.role`). */
export interface PersonDetails {
  occupation: string;
  interests: string[];
  facts: string[];
  phone?: string;
  email?: string;
}
export interface PersonProfile extends Profile, PersonDetails {}

/** Everything collected during signup and editable from You. */
export interface ProfileDraft {
  name: string;
  occupation: string;
  phone: string;
  email: string;
  interests: string[];
  facts: string;
  portraitUrl: string;
}
export const emptyProfileDraft = (): ProfileDraft => ({ name: '', occupation: '', phone: '', email: '', interests: [], facts: '', portraitUrl: '' });

export type AuthStatus = 'signed-out' | 'signed-in';
export interface AuthAdapter {
  /** Simulated in the preview; the production app uses the device credential in `session.ts`. */
  signIn(): Promise<void>;
  signUp(draft: ProfileDraft, enrollment: FaceEnrollmentResult | null): Promise<void>;
  signOut(): Promise<void>;
}

export interface FaceEnrollmentResult {
  templateId: string;
  /** A still captured during enrollment; used as the default portrait. */
  portraitUrl: string;
  capturedAt: number;
  /** True when produced by the sample adapter rather than a camera. */
  sample: boolean;
}
export type FaceEnrollmentStep =
  | { kind: 'capturing'; angle: FaceAngle; progress: number; captured: FaceAngle[] }
  | { kind: 'success'; result: FaceEnrollmentResult }
  | { kind: 'interrupted'; reason: string }
  | { kind: 'unavailable'; reason: string };
/**
 * Account-level face enrollment. This is separate from event-specific
 * recognition consent (`setEventPermission` in `GlanceDataClient`): enrolling
 * lets other attendees recognize you only in events where you turn Glance on.
 */
export interface FaceEnrollmentAdapter {
  availability(): Promise<'available' | 'unavailable'>;
  enroll(onStep: (step: FaceEnrollmentStep) => void, signal: AbortSignal): void;
  remove(): Promise<void>;
}
export interface FaceEnrollmentState {
  status: 'none' | 'enrolled';
  enrolledAt?: number;
  sample: boolean;
}

export interface LinkedInImport {
  name: string;
  headline: string;
  occupation: string;
  interests: string[];
  facts: string[];
  sample: boolean;
}
export interface LinkedInImportAdapter {
  importProfile(): Promise<LinkedInImport>;
}

export type Rsvp = 'going' | 'maybe' | 'cant' | 'none';
export type Visibility = 'invite' | 'open';
export interface EventDetails {
  startsAt: number;
  endsAt?: number;
  address: string;
  description: string;
  purpose: string;
  visibility: Visibility;
  /** Optional host-written conversation prompt shown to guests. */
  prompt: string;
  cover: CoverTheme;
}
export interface EventDraft extends EventDetails {
  title: string;
  location: string;
}
export interface EventView extends Event, EventDetails {
  host: PersonProfile;
  guests: PersonProfile[];
  rsvp: Rsvp;
  joined: boolean;
  isHost: boolean;
  past: boolean;
}

/** Why someone is worth meeting, in plain language. */
export interface Suggestion {
  person: PersonProfile;
  professional: string[];
  personal: string[];
  starters: string[];
  /** Interests both people listed. */
  shared: string[];
}

export type RecognitionPhase =
  | { phase: 'consent' }
  | { phase: 'preparing' }
  | { phase: 'searching' }
  | { phase: 'recognized'; suggestion: Suggestion }
  | { phase: 'unknown' }
  | { phase: 'uncertain'; candidates: PersonProfile[] }
  | { phase: 'permission'; reason: string }
  | { phase: 'error'; message: string };
export type RecognitionScenario = 'recognized' | 'unknown' | 'uncertain' | 'permission' | 'error';
/**
 * Live recognition feed. The real implementation receives frames from the camera
 * and the face directory; the sample adapter plays a scripted scenario.
 */
export interface RecognitionAdapter {
  start(input: { candidates: Suggestion[]; scenario: RecognitionScenario; startIndex: number }, onPhase: (phase: RecognitionPhase) => void): () => void;
}

export interface ConnectionRecord {
  id: string;
  personId: string;
  eventId: string;
  connectedAt: number;
  recap?: Recap;
  messages: ChatMessage[];
  note: string;
  bookmarked: boolean;
  /** `sample` records are seeded fixtures; `conversation` records come from a finished event conversation. */
  origin: 'sample' | 'conversation';
  conversationId?: string;
}

export interface RecognitionPreferences {
  /** Let enabled attendees recognize me by default when I join an event. */
  recognizeByDefault: boolean;
  showStarters: boolean;
}
