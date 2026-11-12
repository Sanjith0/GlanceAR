import { v, ConvexError } from "convex/values";
import { internalMutation, type Id, type MutationCtx } from "./server";
import { authenticate } from "./glance";

/** Muse-backed Discover calls (screenshot reads plus rankings) allowed per profile per UTC day. */
export const DISCOVER_DAILY_LIMIT = 40;

/** People-matching refreshes allowed per profile per UTC day (each is up to two Muse calls). */
export const PEOPLE_DAILY_LIMIT = 40;

/**
 * Counts one Muse-backed call against today's cap for this profile, so a registered
 * device cannot run up the provider bill. Returns false, and counts nothing, at the cap.
 */
export async function countMuseCall(ctx: MutationCtx, profileId: Id<"profiles">, kind: "count" | "people" = "count"): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const rows = await ctx.db.query("discoverUsage").withIndex("by_profile_day", (q) => q.eq("profileId", profileId)).take(8);
  let today: typeof rows[number] | undefined;
  for (const row of rows) {
    if (row.day === day) today = row;
    else await ctx.db.delete(row._id);
  }
  const used = kind === "count" ? today?.count ?? 0 : today?.people ?? 0;
  if (used >= (kind === "count" ? DISCOVER_DAILY_LIMIT : PEOPLE_DAILY_LIMIT)) return false;
  if (today) await ctx.db.patch(today._id, { [kind]: used + 1 });
  else await ctx.db.insert("discoverUsage", { profileId, day, count: 0, [kind]: 1 });
  return true;
}
export const LIMIT_REACHED = "You have reached today's limit for Muse picks. Try again tomorrow.";

/**
 * Authenticates the device and counts one Muse-backed Discover call against today's
 * cap. Returns the caller's own one-line introduction; nothing about their interests
 * is written.
 */
export const begin = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ intro: string }> => {
    const me = await authenticate(ctx, token);
    if (!await countMuseCall(ctx, me._id)) throw new ConvexError(LIMIT_REACHED);
    return { intro: me.role };
  },
});
