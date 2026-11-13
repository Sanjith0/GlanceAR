import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const recapValidator = v.object({
  summary: v.string(),
  topics: v.array(v.string()),
  nextSteps: v.array(v.string()),
  source: v.literal("ai"),
  /** Anonymous diarized turns ("Speaker 1"…), shown behind a button in chat. */
  transcript: v.optional(v.array(v.object({
    speaker: v.string(), startMs: v.number(), endMs: v.number(), text: v.string(),
  }))),
});

export default defineSchema({
  profiles: defineTable({
    tokenHash: v.string(),
    name: v.string(),
    role: v.string(),
    photoUrl: v.string(),
    /**
     * Set on profiles created from the Dev tab. They have no device: their tokenHash is
     * "managed:<id>", which no device credential can hash to, so nobody can sign in as them.
     */
    managedBy: v.optional(v.literal("dev")),
  }).index("by_token", ["tokenHash"]),
  events: defineTable({
    title: v.string(),
    location: v.string(),
    inviteCode: v.string(),
    hostId: v.id("profiles"),
    /**
     * Set when this event was opened from another app's event page ("Join with Glance"),
     * as "<source>:<their event id>". At most one Glance event has a given key.
     */
    externalKey: v.optional(v.string()),
  }).index("by_invite", ["inviteCode"]).index("by_externalKey", ["externalKey"]),
  memberships: defineTable({
    eventId: v.id("events"),
    profileId: v.id("profiles"),
    eventPermission: v.optional(v.object({
      enabled: v.boolean(),
      policyVersion: v.string(),
      grantedAt: v.optional(v.number()),
      revision: v.number(),
    })),
    /**
     * Dev-tab members: LIVE Camera may recognize them in this event, but this is not a
     * recording grant, so no conversation can be started with them.
     */
    recognition: v.optional(v.literal("dev")),
  })
    .index("by_event", ["eventId"])
    .index("by_profile", ["profileId"])
    .index("by_pair", ["eventId", "profileId"]),
  conversations: defineTable({
    eventId: v.id("events"),
    participantA: v.id("profiles"),
    participantB: v.id("profiles"),
    recorderId: v.id("profiles"),
    status: v.union(
      v.literal("consent"), v.literal("recording"), v.literal("ended"),
      v.literal("processing"), v.literal("shared"), v.literal("failed"),
      v.literal("cancelled"),
    ),
    recordingConsent: v.array(v.id("profiles")),
    exchangeConsent: v.array(v.id("profiles")),
    lastSeen: v.record(v.string(), v.number()),
    ticketIssuedAt: v.optional(v.record(v.string(), v.number())),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    leaseUntil: v.optional(v.number()),
    audioStorageId: v.optional(v.id("_storage")),
    audioMimeType: v.optional(v.string()),
    audioExpiresAt: v.optional(v.number()),
    uploadGrantedUntil: v.optional(v.number()),
    generation: v.number(),
    claimedGeneration: v.optional(v.number()),
    recap: v.optional(recapValidator),
    error: v.optional(v.string()),
    consentMode: v.optional(v.union(v.literal("event"), v.literal("conversation"))),
    captureSource: v.optional(v.union(v.literal("phone"), v.literal("glasses"))),
    eventGrantA: v.optional(v.number()),
    eventGrantB: v.optional(v.number()),
    connectedAt: v.optional(v.number()),
    finishMethod: v.optional(v.union(v.literal("gesture"), v.literal("button"))),
    finishEligibleUntil: v.optional(v.number()),
    audioAbandoned: v.optional(v.boolean()),
    /** Live finish: when each participant's camera last saw the other's finish hand. */
    handSignals: v.optional(v.record(v.string(), v.number())),
  })
    .index("by_a", ["participantA"])
    .index("by_b", ["participantB"])
    .index("by_audio", ["audioStorageId"])
    .index("by_status", ["status"])
    .index("by_recorder_status", ["recorderId", "status"])
    .index("by_event_a_mode_status", ["eventId", "participantA", "consentMode", "status"])
    .index("by_event_b_mode_status", ["eventId", "participantB", "consentMode", "status"]),
  messages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.id("profiles"),
    text: v.string(),
    createdAt: v.number(),
  }).index("by_conversation", ["conversationId"]),
  // Opt-in face scan, separate from the portrait. Shared only with members of
  // events where both the owner and the viewer have Glance enabled.
  faceTemplates: defineTable({
    profileId: v.id("profiles"),
    model: v.string(),
    descriptors: v.array(v.array(v.float64())),
    policyVersion: v.string(),
    consentedAt: v.number(),
    /** Saved from the Dev tab, where the operator confirmed the person agreed. */
    attestedBy: v.optional(v.literal("dev")),
  }).index("by_profile", ["profileId"]),
  // "observer's camera recognized seen" claims. Short-lived; two opposite fresh rows pair.
  sightings: defineTable({
    eventId: v.id("events"),
    observerId: v.id("profiles"),
    seenId: v.id("profiles"),
    seenAt: v.number(),
  })
    .index("by_pair", ["eventId", "observerId", "seenId"])
    .index("by_observer", ["observerId"])
    .index("by_seen", ["seenId"])
    .index("by_seen_at", ["seenAt"]),
  presenceTickets: defineTable({
    conversationId: v.id("conversations"),
    profileId: v.id("profiles"),
    issuedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_pair", ["conversationId", "profileId"])
    .index("by_conversation", ["conversationId"])
    .index("by_expiry", ["expiresAt"]),
  // Events (Discover) mode: per-profile daily counters that cap Muse calls
  // (`count`: screenshot reads, Facebook reads and rankings; `people`: people matching).
  // Screenshots, Facebook data and picks are never stored.
  discoverUsage: defineTable({
    profileId: v.id("profiles"),
    day: v.string(),
    count: v.number(),
    people: v.optional(v.number()),
  }).index("by_profile_day", ["profileId", "day"]),
  // People matching is opt-in: a row exists only while its owner has it switched on,
  // and holds the interest phrases they reviewed. Other attendees never receive this list.
  interestProfiles: defineTable({
    profileId: v.id("profiles"),
    interests: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_profile", ["profileId"]),
  // What Muse found a viewer shares with the other opted-in members of one event.
  // `shared` is always the viewer's own wording. Shown only while `key` still matches
  // the interest lists it was computed from, and swept after a day.
  peopleMatches: defineTable({
    profileId: v.id("profiles"),
    eventId: v.id("events"),
    key: v.string(),
    matches: v.array(v.object({ profileId: v.id("profiles"), shared: v.array(v.string()), opener: v.string() })),
    source: v.union(v.literal("muse"), v.literal("basic")),
    model: v.optional(v.string()),
    notice: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_viewer_event", ["profileId", "eventId"])
    .index("by_updated", ["updatedAt"]),
  // A Facebook sign-in in progress, at most one per profile. Only the hash of its
  // one-time state is kept, for ten minutes. No Facebook token or data is ever stored.
  facebookStates: defineTable({
    profileId: v.id("profiles"),
    stateHash: v.string(),
    redirectUri: v.string(),
    expiresAt: v.number(),
  })
    .index("by_profile", ["profileId"])
    .index("by_state", ["stateHash"])
    .index("by_expiry", ["expiresAt"]),
});
