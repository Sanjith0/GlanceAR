/// <reference types="node" />
"use node";

import { anyApi } from "convex/server";
import { v, ConvexError } from "convex/values";
import { env } from "node:process";
import { action } from "./server";
import { validateWav } from "./validation";
import { failureCode, metaBaseUrl, safeError, summarizeTranscript, transcribeDiarized } from "./meta";
import type { Recap } from "../src/domain";

const DISABLED = "Demo summaries are disabled on this deployment.";

/**
 * Diarized transcript and recap for one same-camera demo recording. Nothing is
 * stored: the upload is deleted whatever the outcome and the result goes only to
 * the caller. See demoAudio.ts for why this is local-only.
 */
export const summarize = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<{ recap: Recap }> => {
    if (env.GLANCE_DEMO_SUMMARIES !== "enabled") throw new ConvexError(DISABLED);
    if (await ctx.runQuery(anyApi.demoAudio.isConversationAudio, { storageId })) {
      throw new ConvexError("That recording belongs to a conversation, not the demo.");
    }
    try {
      const key = env.META_API_KEY;
      if (!key) throw new Error("MISSING_KEY");
      const audio = await ctx.storage.get(storageId);
      if (!audio) throw new Error("INVALID_WAV");
      const bytes = await audio.arrayBuffer();
      validateWav(bytes);
      const base = metaBaseUrl(env.META_API_BASE_URL);
      const { turns, forSummary } = await transcribeDiarized(key, bytes, base);
      const recap = await summarizeTranscript(key, forSummary, base);
      return { recap: { ...recap, transcript: turns } };
    } catch (error) {
      // Log and forward only our own failure code/message: never provider bodies, keys or transcripts.
      console.error(`Demo summary failed: ${failureCode(error)}`);
      throw new ConvexError(safeError(error));
    } finally {
      await ctx.storage.delete(storageId).catch(() => {});
    }
  },
});
