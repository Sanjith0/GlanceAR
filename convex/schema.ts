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
  }).index("by_token", ["tokenHash"]),
  events: defineTable({
    title: v.string(),
    location: v.string(),
    inviteCode: v.string(),
    hostId: v.id("profiles"),
  }).index("by_invite", ["inviteCode"]),
  memberships: defineTable({
    eventId: v.id("events"),
    profileId: v.id("profiles"),
    eventPermission: v.optional(v.object({
      enabled: v.boolean(),
      policyVersion: v.string(),
      grantedAt: v.optional(v.number()),
      revision: v.number(),
    })),
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
});
