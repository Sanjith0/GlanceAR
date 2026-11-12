/// <reference types="node" />
"use node";

import { anyApi } from "convex/server";
import { v, ConvexError } from "convex/values";
import { env } from "node:process";
import { action } from "./server";
import { MUSE_MODEL, discoverError, failureCode, metaBaseUrl, rankEvents, readInterests } from "./meta";
import { basicRecommend, cleanInterests, type Recommendation, type Signals, type TasteRead } from "../src/discover/catalog";

/**
 * Events (Discover) mode. Both actions require a registered device, count against
 * its daily cap and store nothing: signals arrive from the caller's memory and the
 * result goes straight back to it. Failures are logged by code only, never with
 * provider bodies, keys, interests or images.
 */

/** Reads interests from a screenshot the caller chose to share. There is no non-AI fallback. */
export const readScreenshot = action({
  args: { token: v.string(), image: v.string() },
  handler: async (ctx, { token, image }): Promise<TasteRead> => {
    await ctx.runMutation(anyApi.discoverData.begin, { token });
    try {
      const key = env.META_API_KEY;
      if (!key) throw new Error("MISSING_KEY");
      return await readInterests(key, image, metaBaseUrl(env.META_API_BASE_URL));
    } catch (error) {
      console.error(`Discover screenshot read failed: ${failureCode(error)}`);
      throw new ConvexError(discoverError(error));
    }
  },
});

/**
 * Ranks the catalog for the caller. Muse Spark does the ranking; if it cannot, the
 * caller still gets the keyword match, labelled `basic` with the reason, never a
 * silent substitute.
 */
export const recommend = action({
  args: {
    token: v.string(),
    interests: v.array(v.string()),
    summary: v.optional(v.string()),
    useIntro: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Recommendation> => {
    if (args.interests.length > 60 || (args.summary ?? "").length > 2_000) throw new ConvexError("Too many signals. Remove a few, then try again.");
    const { intro }: { intro: string } = await ctx.runMutation(anyApi.discoverData.begin, { token: args.token });
    const signals: Signals = {
      interests: cleanInterests(args.interests),
      intro: args.useIntro === false ? "" : intro.trim().slice(0, 120),
      summary: (args.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
    };
    if (!signals.interests.length && !signals.intro) return { picks: [], source: "basic" };
    try {
      const key = env.META_API_KEY;
      if (!key) throw new Error("MISSING_KEY");
      const picks = await rankEvents(key, signals, metaBaseUrl(env.META_API_BASE_URL));
      return { picks, source: "muse", model: MUSE_MODEL };
    } catch (error) {
      console.error(`Discover ranking failed: ${failureCode(error)}`);
      return { ...basicRecommend(signals), notice: `${discoverError(error)} Showing a basic keyword match instead.` };
    }
  },
});
