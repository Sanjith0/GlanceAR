import { v, ConvexError } from "convex/values";
import { mutation, internalMutation, type Id, type MutationCtx } from "./server";
import { authenticate } from "./glance";
import { LIMIT_REACHED, countMuseCall } from "./discoverData";
import { eventPeople, storedMatch, worthAsking } from "./peopleView";
import { MAX_INTERESTS, cleanInterests } from "../src/discover/catalog";
import { basicMatches, type Candidate } from "../src/discover/people";

/**
 * People matching and Facebook sign-in, write side.
 *
 * Matching is opt-in. Switching it on saves the interests a person reviewed so that
 * other opted-in attendees of the same event can be shown what they share; switching
 * it off deletes them. A Facebook sign-in keeps one hashed, single-use state for ten
 * minutes and nothing else.
 */
export const FACEBOOK_STATE_TTL_MS = 10 * 60_000;
/** Stored match results older than this are swept; the app then asks again. */
export const PEOPLE_MATCH_RETENTION_MS = 24 * 60 * 60_000;
export const PEOPLE_LIMIT_NOTICE = "You have reached today’s limit for Muse people matching. Showing a basic match until tomorrow.";
export const PEOPLE_LIMIT_KEPT_NOTICE = "You have reached today’s limit for Muse people matching. This is the latest Muse match.";

const matchRow = v.object({ profileId: v.id("profiles"), shared: v.array(v.string()), opener: v.string() });
const interestRow = (ctx: MutationCtx, profileId: Id<"profiles">) =>
  ctx.db.query("interestProfiles").withIndex("by_profile", (q) => q.eq("profileId", profileId)).unique();

/** Switches people matching on, or replaces the saved list while it is on. Returns the list as stored. */
export const saveInterests = mutation({
  args: { token: v.string(), interests: v.array(v.string()) },
  handler: async (ctx, args): Promise<string[]> => {
    const me = await authenticate(ctx, args.token);
    if (args.interests.length > 60 || args.interests.some((interest) => interest.length > 200)) {
      throw new ConvexError("Too many signals. Remove a few, then try again.");
    }
    const interests = cleanInterests(args.interests, MAX_INTERESTS);
    const row = await interestRow(ctx, me._id);
    if (!row) await ctx.db.insert("interestProfiles", { profileId: me._id, interests, updatedAt: Date.now() });
    else if (JSON.stringify(row.interests) !== JSON.stringify(interests)) await ctx.db.patch(row._id, { interests, updatedAt: Date.now() });
    return interests;
  },
});

/** Switches people matching off: deletes the saved interests and this person's stored matches. */
export const clearInterests = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<void> => {
    const me = await authenticate(ctx, token);
    const row = await interestRow(ctx, me._id);
    if (row) await ctx.db.delete(row._id);
    // Other people's stored matches that mention this person stop being shown at once
    // (their fingerprint no longer matches) and are swept within a day.
    const matches = await ctx.db.query("peopleMatches").withIndex("by_viewer_event", (q) => q.eq("profileId", me._id)).take(100);
    for (const match of matches) await ctx.db.delete(match._id);
  },
});

async function replaceMatch(
  ctx: MutationCtx, profileId: Id<"profiles">, eventId: Id<"events">,
  value: { key: string; matches: { profileId: Id<"profiles">; shared: string[]; opener: string }[]; source: "muse" | "basic"; model?: string; notice?: string },
) {
  const old = await storedMatch(ctx, profileId, eventId);
  if (old) await ctx.db.delete(old._id);
  await ctx.db.insert("peopleMatches", { profileId, eventId, ...value, updatedAt: Date.now() });
}

export interface MatchWork {
  profileId: Id<"profiles">;
  title: string;
  mine: string[];
  /** Opted-in members with at least one interest. Server side only. */
  candidates: Candidate[];
  key: string;
}
/**
 * Decides whether Muse should look at this event for the caller, and if so counts
 * the call and hands the action what it needs. Null means there is nothing to do.
 */
export const beginMatch = internalMutation({
  args: { token: v.string(), eventId: v.id("events"), force: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<MatchWork | null> => {
    const me = await authenticate(ctx, args.token);
    const event = await ctx.db.get(args.eventId);
    const members = await ctx.db.query("memberships").withIndex("by_event", (q) => q.eq("eventId", args.eventId)).take(24);
    if (!event || !members.some((member) => member.profileId === me._id)) throw new ConvexError("Event unavailable.");
    const people = await eventPeople(ctx, me._id, members);
    if (!people) throw new ConvexError("Turn on people matching in your signals first.");
    const stored = await storedMatch(ctx, me._id, args.eventId);
    if (!worthAsking(people)) {
      if (stored) await ctx.db.delete(stored._id);
      return null;
    }
    if (stored && stored.key === people.key && stored.source === "muse" && !args.force) return null;
    if (!await countMuseCall(ctx, me._id, "people")) {
      // A refresh at the cap must not throw away a Muse result that is still current.
      if (stored && stored.key === people.key && stored.source === "muse") {
        if (stored.notice !== PEOPLE_LIMIT_KEPT_NOTICE) await ctx.db.patch(stored._id, { notice: PEOPLE_LIMIT_KEPT_NOTICE });
        return null;
      }
      await replaceMatch(ctx, me._id, args.eventId, {
        key: people.key, source: "basic", notice: PEOPLE_LIMIT_NOTICE,
        matches: basicMatches(people.mine, people.candidates).map(({ id, ...rest }) => ({ profileId: id as Id<"profiles">, ...rest })),
      });
      return null;
    }
    return {
      profileId: me._id, title: event.title, mine: people.mine, key: people.key,
      candidates: people.candidates.filter((candidate) => candidate.interests.length > 0),
    };
  },
});

/**
 * Stores a finished match, unless anyone's interests changed while Muse was working.
 * Only the viewer's own phrases, and only current opted-in members, are kept.
 */
export const finishMatch = internalMutation({
  args: {
    profileId: v.id("profiles"), eventId: v.id("events"), key: v.string(), matches: v.array(matchRow),
    source: v.union(v.literal("muse"), v.literal("basic")), model: v.optional(v.string()), notice: v.optional(v.string()),
  },
  handler: async (ctx, { profileId, eventId, ...value }): Promise<boolean> => {
    const members = await ctx.db.query("memberships").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(24);
    if (!members.some((member) => member.profileId === profileId)) return false;
    const people = await eventPeople(ctx, profileId, members);
    if (!people || people.key !== value.key) return false;
    const own = new Set(people.mine), ids = new Set(people.candidates.map((candidate) => candidate.id));
    const seen = new Set<string>();
    const matches = value.matches.flatMap((match) => {
      const shared = match.shared.filter((phrase) => own.has(phrase));
      if (!ids.has(match.profileId) || seen.has(match.profileId) || !shared.length) return [];
      seen.add(match.profileId);
      return [{ profileId: match.profileId, shared, opener: match.opener.replace(/\s+/g, " ").trim().slice(0, 140) }];
    });
    await replaceMatch(ctx, profileId, eventId, { ...value, matches, ...(value.notice ? { notice: value.notice.slice(0, 300) } : {}) });
    return true;
  },
});

/** Remembers the hash of a new sign-in's state for the calling device, replacing any earlier one. */
export const startFacebook = internalMutation({
  args: { token: v.string(), stateHash: v.string(), redirectUri: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const me = await authenticate(ctx, args.token);
    const pending = await ctx.db.query("facebookStates").withIndex("by_profile", (q) => q.eq("profileId", me._id)).take(10);
    for (const row of pending) await ctx.db.delete(row._id);
    await ctx.db.insert("facebookStates", {
      profileId: me._id, stateHash: args.stateHash, redirectUri: args.redirectUri, expiresAt: Date.now() + FACEBOOK_STATE_TTL_MS,
    });
  },
});

/**
 * Uses up a sign-in state. It must be unexpired and belong to the calling device, so
 * a code obtained by one person cannot be attached to another's profile. Counts the
 * Muse read that follows against the daily cap.
 */
export const claimFacebook = internalMutation({
  args: { token: v.string(), stateHash: v.string() },
  handler: async (ctx, args): Promise<{ redirectUri: string }> => {
    const me = await authenticate(ctx, args.token);
    const row = await ctx.db.query("facebookStates").withIndex("by_state", (q) => q.eq("stateHash", args.stateHash)).unique();
    if (!row || row.profileId !== me._id || row.expiresAt <= Date.now()) {
      throw new ConvexError("That Facebook sign-in expired or was already used. Start again.");
    }
    if (!await countMuseCall(ctx, me._id)) throw new ConvexError(LIMIT_REACHED);
    await ctx.db.delete(row._id);
    return { redirectUri: row.redirectUri };
  },
});
