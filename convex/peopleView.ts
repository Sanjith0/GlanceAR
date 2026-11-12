import type { Doc, Id, QueryCtx } from "./server";
import { basicMatches, peopleKey, type Candidate, type SharedWith } from "../src/discover/people";
import type { PeopleMatching } from "../src/domain";

/**
 * People matching, read side. Other attendees' interest lists are loaded here and
 * never leave the server: a viewer receives only phrases from their own list.
 */

/** The interests a person saved when they switched people matching on; undefined while it is off. */
export async function savedInterests(ctx: QueryCtx, profileId: Id<"profiles">): Promise<string[] | undefined> {
  const row = await ctx.db.query("interestProfiles").withIndex("by_profile", (q) => q.eq("profileId", profileId)).unique();
  return row?.interests;
}

export interface EventPeople {
  mine: string[];
  /** The other members of the event who also switched matching on. */
  candidates: Candidate[];
  /** Fingerprint of every list above; a stored match is current only while this is unchanged. */
  key: string;
}
/** Null when the viewer has people matching switched off. */
export async function eventPeople(ctx: QueryCtx, viewerId: Id<"profiles">, members: Doc<"memberships">[]): Promise<EventPeople | null> {
  const mine = await savedInterests(ctx, viewerId);
  if (!mine) return null;
  const candidates: Candidate[] = [];
  for (const member of members) {
    if (member.profileId === viewerId) continue;
    const interests = await savedInterests(ctx, member.profileId);
    if (interests) candidates.push({ id: member.profileId, interests });
  }
  return { mine, candidates, key: peopleKey(mine, candidates) };
}
/** True when there is something Muse could compare. */
export const worthAsking = (people: EventPeople): boolean =>
  people.mine.length > 0 && people.candidates.some((candidate) => candidate.interests.length > 0);

export const storedMatch = (ctx: QueryCtx, viewerId: Id<"profiles">, eventId: Id<"events">) =>
  ctx.db.query("peopleMatches").withIndex("by_viewer_event", (q) => q.eq("profileId", viewerId).eq("eventId", eventId)).unique();

/**
 * What the viewer sees for one event: Muse's stored result while it still describes
 * the current lists, otherwise the wording match, flagged stale so the app asks Muse.
 * `lines` has an entry for every opted-in member, empty when nothing is shared.
 */
export async function matchingView(
  ctx: QueryCtx, viewerId: Id<"profiles">, eventId: Id<"events">, people: EventPeople,
): Promise<{ matching: PeopleMatching; lines: Map<string, SharedWith> }> {
  const lines = new Map<string, SharedWith>(people.candidates.map((candidate) => [candidate.id, { shared: [], opener: "" }]));
  const stored = await storedMatch(ctx, viewerId, eventId);
  if (stored && stored.key === people.key) {
    const own = new Set(people.mine);
    for (const match of stored.matches) {
      const shared = match.shared.filter((phrase) => own.has(phrase));
      if (lines.has(match.profileId) && shared.length) lines.set(match.profileId, { shared, opener: match.opener });
    }
    return {
      lines,
      matching: {
        source: stored.source, stale: false,
        ...(stored.model ? { model: stored.model } : {}), ...(stored.notice ? { notice: stored.notice } : {}),
      },
    };
  }
  for (const match of basicMatches(people.mine, people.candidates)) lines.set(match.id, { shared: match.shared, opener: match.opener });
  return { lines, matching: { source: "basic", stale: worthAsking(people) } };
}
