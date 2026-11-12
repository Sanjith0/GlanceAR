/// <reference types="node" />
"use node";

import { anyApi } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "./server";
import { validateWav } from "./validation";
import { failureCode, metaBaseUrl, safeError, summarizeTranscript, transcribeDiarized } from "./meta";

export const process = internalAction({
  args: { conversationId: v.id("conversations"), generation: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.runMutation(anyApi.jobs.claim, args);
    if (!job) return;
    try {
      // `process` is this module's action, so the Node global is named in full. Read at call time:
      // an imported `env` binding goes stale when the deployment's variables change.
      const key = globalThis.process.env.META_API_KEY;
      if (!key) throw new Error("MISSING_KEY");
      const audio = await ctx.storage.get(job.storageId);
      if (!audio) throw new Error("INVALID_WAV");
      const bytes = await audio.arrayBuffer();
      validateWav(bytes, Math.max(0, job.endedAt - job.startedAt) + 2000);
      if (!await ctx.runQuery(anyApi.jobs.canProcess, args)) return;
      const base = metaBaseUrl(globalThis.process.env.META_API_BASE_URL);
      const { turns, forSummary } = await transcribeDiarized(key, bytes, base);
      if (!await ctx.runQuery(anyApi.jobs.canProcess, args)) return;
      const recap = await summarizeTranscript(key, forSummary, base);
      await ctx.runMutation(anyApi.jobs.finish, { ...args, recap: { ...recap, transcript: turns } });
    } catch (error) {
      // Never log provider bodies, API keys, transcripts, photos, or device credentials; the code is ours.
      console.error(`Recap processing failed: ${failureCode(error)}`);
      await ctx.runMutation(anyApi.jobs.finish, { ...args, error: safeError(error) });
    }
  },
});
