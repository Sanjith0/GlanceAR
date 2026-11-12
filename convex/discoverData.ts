import { v, ConvexError } from "convex/values";
import { internalMutation } from "./server";
import { authenticate } from "./glance";

/** Muse-backed Discover calls (screenshot reads plus rankings) allowed per profile per UTC day. */
export const DISCOVER_DAILY_LIMIT = 40;

/**
 * Authenticates the device and counts one Muse-backed Discover call against today's
 * cap, so a registered device cannot run up the provider bill. Returns the caller's
 * own one-line introduction; nothing about their interests is written.
 */
export const begin = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ intro: string }> => {
    const me = await authenticate(ctx, token);
    const day = new Date().toISOString().slice(0, 10);
    const rows = await ctx.db.query("discoverUsage").withIndex("by_profile_day", (q) => q.eq("profileId", me._id)).take(8);
    let today: typeof rows[number] | undefined;
    for (const row of rows) {
      if (row.day === day) today = row;
      else await ctx.db.delete(row._id);
    }
    if (today && today.count >= DISCOVER_DAILY_LIMIT) {
      throw new ConvexError("You have reached today's limit for Muse picks. Try again tomorrow.");
    }
    if (today) await ctx.db.patch(today._id, { count: today.count + 1 });
    else await ctx.db.insert("discoverUsage", { profileId: me._id, day, count: 1 });
    return { intro: me.role };
  },
});
