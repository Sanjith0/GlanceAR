/// <reference types="node" />
import { v, ConvexError } from "convex/values";
import { internalQuery, mutation } from "./server";

/**
 * Same-camera demo summaries for a LOCAL development deployment. Off unless the
 * deployment sets GLANCE_DEMO_SUMMARIES=enabled. These functions are unauthenticated
 * and spend Meta credit, so never enable the flag on a shared or public deployment.
 */
export const DEMO_DISABLED = "Demo summaries are disabled on this deployment.";
export const demoSummariesEnabled = () => process.env.GLANCE_DEMO_SUMMARIES === "enabled";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    if (!demoSummariesEnabled()) throw new ConvexError(DEMO_DISABLED);
    // Unattached uploads are removed by jobs.sweep after the raw-audio retention window.
    return ctx.storage.generateUploadUrl();
  },
});

/** A demo call must never read or delete a real conversation's recording. */
export const isConversationAudio = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => (await ctx.db.query("conversations")
    .withIndex("by_audio", (q) => q.eq("audioStorageId", storageId)).first()) !== null,
});
