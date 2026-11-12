/// <reference types="node" />
"use node";

import { anyApi } from "convex/server";
import { v } from "convex/values";
import { action } from "./server";
import { MUSE_MODEL, discoverError, failureCode, metaBaseUrl, sharedPairs, writeOpeners } from "./meta";
import type { MatchWork } from "./peopleData";
import { basicMatches, basicOpener, mergeShared, sharedInterests } from "../src/discover/people";

/**
 * Asks Muse Spark what the caller has in common with the other opted-in attendees
 * of one event, and stores the answer for the caller's snapshot.
 *
 * Two calls keep other people's lists private. The first sees both lists and returns
 * pairs, each checked against the real lists; identical wording counts as well. The
 * second writes the openers and is given only the confirmed overlap in the caller's
 * own words. If Muse cannot answer, the caller keeps the looser wording match,
 * labelled basic with the reason.
 */
export type MatchOutcome = "muse" | "basic" | "current" | "stale";

export const match = action({
  args: { token: v.string(), eventId: v.id("events"), force: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<MatchOutcome> => {
    const work: MatchWork | null = await ctx.runMutation(anyApi.peopleData.beginMatch, args);
    if (!work) return "current";
    const { mine, candidates } = work;
    let result: { matches: { profileId: string; shared: string[]; opener: string }[]; source: "muse" | "basic"; model?: string; notice?: string };
    try {
      const key = process.env.META_API_KEY;
      if (!key) throw new Error("MISSING_KEY");
      const base = metaBaseUrl(process.env.META_API_BASE_URL);
      const pairs = await sharedPairs(key, mine, candidates, base);
      const shared = new Map(candidates.map((candidate) =>
        [candidate.id, mergeShared(mine, sharedInterests(mine, candidate.interests, false), pairs.get(candidate.id))]));
      let openers = new Map<string, string>(), notice: string | undefined;
      try {
        openers = await writeOpeners(key, work.title, candidates, shared, base);
      } catch (error) {
        console.error(`People openers failed: ${failureCode(error)}`);
        notice = "Muse found what you share but could not write openers just now, so these are plain questions.";
      }
      result = {
        source: "muse", model: MUSE_MODEL, ...(notice ? { notice } : {}),
        matches: candidates.flatMap((candidate) => {
          const phrases = shared.get(candidate.id) ?? [];
          return phrases.length ? [{ profileId: candidate.id, shared: phrases, opener: openers.get(candidate.id) ?? basicOpener(phrases) }] : [];
        }),
      };
    } catch (error) {
      console.error(`People matching failed: ${failureCode(error)}`);
      result = {
        source: "basic", notice: `${discoverError(error)} Showing a basic match instead.`,
        matches: basicMatches(mine, candidates).map(({ id, ...rest }) => ({ profileId: id, ...rest })),
      };
    }
    const stored: boolean = await ctx.runMutation(anyApi.peopleData.finishMatch, {
      profileId: work.profileId, eventId: args.eventId, key: work.key, ...result,
    });
    return stored ? result.source : "stale";
  },
});
