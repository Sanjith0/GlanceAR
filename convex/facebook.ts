/// <reference types="node" />
"use node";

import { anyApi } from "convex/server";
import { v, ConvexError } from "convex/values";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { action } from "./server";
import { discoverError, failureCode, interestsFromFacebook, metaBaseUrl } from "./meta";
import { dialogUrl, facebookConfig, facebookError, facebookRedirect, readFacebook } from "./facebookGraph";
import type { TasteRead } from "../src/discover/catalog";

/**
 * "Connect Facebook" for the Events view. `begin` hands the caller a Login dialog
 * URL and a one-time state; `complete` trades the code Facebook returned for a
 * single read of the person's liked Pages and recent posts, removes Glance's
 * access again, and then asks Muse Spark for interests. The interests go back to the
 * caller to review; nothing from Facebook is written to the database.
 */
export interface FacebookRead extends TasteRead {
  /** How many liked Pages and posts Muse was given. */
  pages: number;
  posts: number;
  /** True when Facebook confirmed that Glance's access was removed afterwards. */
  revoked: boolean;
}
const stateHash = (state: string) => bytesToHex(sha256(utf8ToBytes(state)));
const fail = (error: unknown): never => {
  if (error instanceof ConvexError) throw error;
  console.error(`Facebook connect failed: ${failureCode(error)}`);
  throw new ConvexError(facebookError(error) ?? discoverError(error));
};

export const begin = action({
  args: { token: v.string(), redirectUri: v.string() },
  handler: async (ctx, args): Promise<{ url: string; state: string }> => {
    try {
      const config = facebookConfig(process.env);
      // No point sending someone through Facebook if Muse cannot read the result.
      if (!process.env.META_API_KEY) throw new Error("MISSING_KEY");
      const redirectUri = facebookRedirect(args.redirectUri);
      const state = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      await ctx.runMutation(anyApi.peopleData.startFacebook, { token: args.token, stateHash: stateHash(state), redirectUri });
      return { url: dialogUrl(config, redirectUri, state), state };
    } catch (error) {
      return fail(error);
    }
  },
});

export const complete = action({
  args: { token: v.string(), state: v.string(), code: v.string() },
  handler: async (ctx, args): Promise<FacebookRead> => {
    if (!/^[a-f0-9]{64}$/.test(args.state) || !args.code || args.code.length > 4_000) {
      throw new ConvexError("That Facebook sign-in could not be verified. Start again.");
    }
    // Single use, and only for the device that started it.
    const { redirectUri }: { redirectUri: string } = await ctx.runMutation(anyApi.peopleData.claimFacebook, {
      token: args.token, stateHash: stateHash(args.state),
    });
    try {
      const config = facebookConfig(process.env);
      const key = process.env.META_API_KEY;
      if (!key) throw new Error("MISSING_KEY");
      const { revoked, ...activity } = await readFacebook(config, args.code, redirectUri);
      const read = await interestsFromFacebook(key, activity, metaBaseUrl(process.env.META_API_BASE_URL));
      return { ...read, pages: activity.pages.length, posts: activity.posts.length, revoked };
    } catch (error) {
      return fail(error);
    }
  },
});
