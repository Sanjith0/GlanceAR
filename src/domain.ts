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
  /** Anonymous diarized turns, shown behind a button. */
  transcript?: SpeakerTurn[];
}

/** "Speaker 1", "Speaker 2"… by first appearance; never a participant identity. */
export interface SpeakerTurn {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
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

/** One opted-in attendee's face templates. Never derived from the profile portrait. */
export interface FaceTemplate {
  profileId: string;
  descriptors: number[][];
}

export interface FaceDirectory {
  model: string;
  /** False when the viewer has not enabled Glance for this event; templates are then withheld. */
  enabled: boolean;
  /** Whether the viewer has a saved face scan others can recognize. */
  scanned: boolean;
  /** Enabled event members with a face scan, including the viewer (shown as "You"). */
  templates: FaceTemplate[];
}

export interface FaceScanInput {
  model: string;
  descriptors: number[][];
  policyVersion: string;
}

export interface SightingResult {
  /** waiting: the other phone has not recognized you yet. busy: someone is already in a conversation. */
  status: "waiting" | "paired" | "busy";
  conversationId?: string;
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
  saveFaceScan(token: string, scan: FaceScanInput): Promise<void>;
  deleteFaceScan(token: string): Promise<void>;
  /** Reactive: re-delivers whenever an attendee joins, enables, pauses, scans, or deletes a scan. */
  subscribeFaceDirectory(
    token: string,
    eventId: string,
    onValue: (directory: FaceDirectory) => void,
    onError?: (error: Error) => void,
  ): () => void;
  /** "I recognize this attendee." Pairs automatically once both phones report each other. */
  reportSighting(
    token: string,
    eventId: string,
    seenId: string,
    source?: "phone" | "glasses",
  ): Promise<SightingResult>;
  close(): Promise<void>;
}

export const RECORDING_FRESHNESS_MS = 5_000;
export const MAX_RECORDING_MS = 10 * 60_000;
export const RAW_AUDIO_RETENTION_MS = 15 * 60_000;
export const EVENT_PERMISSION_POLICY_VERSION = "glance-event-v1";
export const FACE_SCAN_POLICY_VERSION = "glance-face-v1";
/** face-api.js ResNet-34 descriptor (dlib port). Templates from another model never match. */
export const FACE_MODEL = "face-api-resnet128-v1";
export const FACE_DESCRIPTOR_LENGTH = 128;
export const FACE_SCAN_SAMPLES = 3;
/** Both phones must recognize each other within this window to pair. */
export const SIGHTING_WINDOW_MS = 8_000;
export const SIGHTING_REPORT_INTERVAL_MS = 1_000;
/** The preview's fictional face database cap. */
export const DEMO_FACE_LIMIT = 5;
