/** Public, redacted wire types. Device bearer tokens never belong in these objects. */
export interface Profile {
  id: string;
  name: string;
  role: string;
  photoUrl: string;
  /** Only present on me/members when a specific event is selected. */
  glanceEnabled?: boolean;
}

export interface Event {
  id: string;
  title: string;
  location: string;
  inviteCode: string;
  hostId: string;
}

export interface Recap {
  summary: string;
  topics: string[];
  nextSteps: string[];
  source: "ai" | "sample";
}

export type ConversationStatus =
  | "consent"
  | "recording"
  | "ended"
  | "processing"
  | "shared"
  | "failed"
  | "cancelled";

export interface Conversation {
  id: string;
  eventId: string;
  participants: Profile[];
  recorderId: string;
  status: ConversationStatus;
  recordingConsent: string[];
  exchangeConsent: string[];
  startedAt?: number;
  endedAt?: number;
  /** Absolute server epoch ms. Stop the microphone locally at this deadline. */
  leaseUntil?: number;
  recap?: Recap;
  error?: string;
  consentMode?: "event" | "conversation";
  /** Immutable capture owner selected when this conversation is created. */
  captureSource?: "phone" | "glasses";
  connectedAt?: number;
  finishMethod?: "gesture" | "button";
  messages?: ChatMessage[];
  /** Advisory snapshot only; startRecording rechecks current server authorization. */
  readyToRecord?: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: number;
}

export interface EventPermission {
  enabled: boolean;
  policyVersion: string;
  grantedAt?: number;
}

export interface Snapshot {
  me: Profile;
  events: Event[];
  event?: Event;
  members: Profile[];
  /** Only the authenticated user's conversations, never other attendees' sessions. */
  conversations: Conversation[];
  eventPermission?: EventPermission;
  /** Global recorder-owned consent/recording session, even when another event is selected. */
  activeRecorderConversationId?: string;
}

export interface ProfileInput {
  name: string;
  role: string;
  /** Required selfie, JPEG/PNG/WebP data URL, at most 350,000 encoded characters. */
  photoUrl: string;
}

export interface RecordingLease {
  leaseUntil: number;
  serverNow: number;
}

export interface PresenceTicket {
  ticketId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface StopResult {
  status: ConversationStatus;
  /** Explicit null means this stop won before any connection and future finish is closed. */
  connectedAt: number | null;
}

export interface GlanceDataClient {
  register(token: string, profile: ProfileInput): Promise<string>;
  updateProfile(token: string, profile: ProfileInput): Promise<void>;
  snapshot(token: string, eventId?: string): Promise<Snapshot>;
  subscribe(
    token: string,
    eventId: string | undefined,
    onValue: (snapshot: Snapshot) => void,
    onError?: (error: Error) => void,
  ): () => void;
  createEvent(token: string, title: string, location: string): Promise<string>;
  joinEvent(token: string, inviteCode: string): Promise<string>;
  setEventPermission(token: string, eventId: string, enabled: boolean): Promise<void>;
  createConversation(
    token: string,
    eventId: string,
    partnerId: string,
    mode?: "event",
    source?: "phone" | "glasses",
  ): Promise<string>;
  consentRecording(token: string, conversationId: string): Promise<void>;
  startRecording(token: string, conversationId: string): Promise<RecordingLease>;
  /**
   * Both phones call every ~1s. The wrapper requests a one-time server ticket, then
   * acknowledges ONLY if stillConsenting remains true. Capture callers must supply
   * a foreground/focus/operation-generation guard; never extend a lease optimistically.
   */
  heartbeat(
    token: string,
    conversationId: string,
    stillConsenting?: () => boolean,
  ): Promise<RecordingLease | null>;
  /** Real backend returns StopResult; void only preserves compatibility with legacy adapters. */
  stop(token: string, conversationId: string): Promise<StopResult | void>;
  /** Event-mode only. Call after the native microphone has acknowledged closure. */
  finishConnection(token: string, conversationId: string, method: "gesture" | "button"): Promise<void>;
  abandonAudio(token: string, conversationId: string): Promise<void>;
  sendMessage(token: string, conversationId: string, text: string): Promise<string>;
  confirmExchange(token: string, conversationId: string): Promise<void>;
  createUploadUrl(token: string, conversationId: string): Promise<string>;
  attachAudio(
    token: string,
    conversationId: string,
    storageId: string,
    mimeType: string,
  ): Promise<void>;
  retryProcessing(token: string, conversationId: string): Promise<void>;
  cancel(token: string, conversationId: string): Promise<void>;
  deleteConversation(token: string, conversationId: string): Promise<void>;
  close(): Promise<void>;
}

export const RECORDING_FRESHNESS_MS = 5_000;
export const MAX_RECORDING_MS = 10 * 60_000;
export const RAW_AUDIO_RETENTION_MS = 15 * 60_000;
export const EVENT_PERMISSION_POLICY_VERSION = "glance-event-v1";
