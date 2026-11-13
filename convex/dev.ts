import { v, ConvexError } from "convex/values";
import { query, mutation, type QueryCtx, type MutationCtx, type Doc, type Id } from "./server";
import { clearSightings, demoMode, validateProfile } from "./glance";
import { DEV_PEOPLE_LIMIT, FACE_MODEL, FACE_SCAN_POLICY_VERSION, type DevOverview, type DevPerson } from "../src/domain";
import { compactDescriptor, faceDistance, validDescriptors, MATCH_THRESHOLD } from "../src/face";

/**
 * The hidden Dev tools' backend: see every face scan, and add, rename, rescan and
 * remove profiles that have no device of their own.
 *
 * There is no key. These functions are public, so anyone who can reach this backend
 * and knows they exist can call them, with or without the app's hidden shortcut.
 * The one safeguard is the switch below: they refuse everything unless the
 * GLANCE_DEV_TOOLS environment variable is "enabled". Leave it unset on any backend
 * that holds face scans of people who should not be listed or deleted by strangers.
 */
const fail = (message: string): never => { throw new ConvexError(message); };
const scanArgs = { model: v.string(), descriptors: v.array(v.array(v.float64())), policyVersion: v.string() };
const MANAGED_PREFIX = "managed:";
export const DEV_TOOLS_OFF = "Dev tools are off on this backend. Turn them on with: npx convex env set GLANCE_DEV_TOOLS enabled";

function allow(): void {
  if (!demoMode()) fail(DEV_TOOLS_OFF);
}

const template = (ctx: QueryCtx, profileId: Id<"profiles">) =>
  ctx.db.query("faceTemplates").withIndex("by_profile", (q) => q.eq("profileId", profileId)).unique();

async function managedProfile(ctx: QueryCtx, profileId: Id<"profiles">): Promise<Doc<"profiles">> {
  const row = await ctx.db.get(profileId);
  if (!row) fail("That profile no longer exists.");
  if (row!.managedBy !== "dev") fail("This person signed up on their own device. Only they can change their profile.");
  return row!;
}

function checkedScan(args: { model: string; descriptors: number[][]; policyVersion: string }) {
  if (args.model !== FACE_MODEL) fail("This face scan came from an unsupported model. Update Glance and scan again.");
  if (args.policyVersion !== FACE_SCAN_POLICY_VERSION) fail("Review and accept the current face scan terms.");
  if (!validDescriptors(args.descriptors)) fail("That face scan is incomplete. Try scanning again.");
  return args.descriptors.map(compactDescriptor);
}

/** One face, one person: refuses a scan that already matches somebody else's. */
async function refuseDuplicate(ctx: QueryCtx, descriptors: number[][], except?: Id<"profiles">) {
  const rows = await ctx.db.query("faceTemplates").order("desc").take(DEV_PEOPLE_LIMIT);
  for (const row of rows) {
    if (row.profileId === except) continue;
    if (!row.descriptors.some((saved) => descriptors.some((sample) => faceDistance(sample, saved) < MATCH_THRESHOLD))) continue;
    const owner = await ctx.db.get(row.profileId);
    fail(`This face already matches ${owner?.name ?? "another person"}’s scan, so it wasn’t saved.`);
  }
}

async function saveTemplate(ctx: MutationCtx, profileId: Id<"profiles">, descriptors: number[][]) {
  const value = {
    model: FACE_MODEL, descriptors, policyVersion: FACE_SCAN_POLICY_VERSION, consentedAt: Date.now(),
    attestedBy: "dev" as const,
  };
  const existing = await template(ctx, profileId);
  if (existing) await ctx.db.patch(existing._id, value);
  else await ctx.db.insert("faceTemplates", { profileId, ...value });
}

async function person(ctx: QueryCtx, row: Doc<"profiles">, scan: Doc<"faceTemplates"> | null): Promise<DevPerson> {
  const memberships = await ctx.db.query("memberships").withIndex("by_profile", (q) => q.eq("profileId", row._id)).take(12);
  const events = await Promise.all(memberships.map(async (m) => {
    const event = await ctx.db.get(m.eventId);
    return event ? { id: event._id as string, title: event.title, recognized: m.recognition === "dev" || m.eventPermission?.enabled === true } : null;
  }));
  return {
    id: row._id, name: row.name, role: row.role, managed: row.managedBy === "dev",
    scan: scan ? {
      samples: scan.descriptors.length, consentedAt: scan.consentedAt,
      current: scan.model === FACE_MODEL && scan.policyVersion === FACE_SCAN_POLICY_VERSION,
    } : null,
    events: events.filter((event) => event !== null),
  };
}

/** Everyone with a face scan (newest first), then Dev-added profiles that have none. */
export const overview = query({
  args: {},
  handler: async (ctx): Promise<DevOverview> => {
    allow();
    const scans = await ctx.db.query("faceTemplates").order("desc").take(DEV_PEOPLE_LIMIT + 1);
    const truncated = scans.length > DEV_PEOPLE_LIMIT;
    const people: DevPerson[] = [];
    const listed = new Set<string>();
    for (const scan of scans.slice(0, DEV_PEOPLE_LIMIT)) {
      const row = await ctx.db.get(scan.profileId);
      if (!row) continue;
      listed.add(row._id);
      people.push(await person(ctx, row, scan));
    }
    // Managed profiles share the "managed:" token prefix, so the token index finds them.
    const managed = await ctx.db.query("profiles").withIndex("by_token", (q) =>
      q.gte("tokenHash", MANAGED_PREFIX).lt("tokenHash", "managed;")).take(DEV_PEOPLE_LIMIT);
    for (const row of managed) {
      if (!listed.has(row._id) && people.length < DEV_PEOPLE_LIMIT) people.push(await person(ctx, row, null));
    }
    const events = await ctx.db.query("events").order("desc").take(40);
    return { events: events.map((event) => ({ id: event._id as string, title: event.title })), people, truncated };
  },
});

/** A new profile with no device, a face scan, and optionally a place in one event. */
export const addProfile = mutation({
  args: {
    ...scanArgs, name: v.string(), role: v.string(), photoUrl: v.string(),
    eventId: v.optional(v.id("events")),
    /** The operator ticked that this person agreed to be scanned and recognized. */
    agreed: v.boolean(),
  },
  handler: async (ctx, args): Promise<string> => {
    allow();
    if (!args.agreed) fail("Confirm the person agreed to be scanned and recognized.");
    const fields = validateProfile({ name: args.name, role: args.role, photoUrl: args.photoUrl });
    const descriptors = checkedScan(args);
    await refuseDuplicate(ctx, descriptors);
    if (args.eventId && !await ctx.db.get(args.eventId)) fail("That event no longer exists.");
    const profileId = await ctx.db.insert("profiles", { ...fields, tokenHash: MANAGED_PREFIX, managedBy: "dev" });
    await ctx.db.patch(profileId, { tokenHash: `${MANAGED_PREFIX}${profileId}` });
    await saveTemplate(ctx, profileId, descriptors);
    if (args.eventId) await ctx.db.insert("memberships", { eventId: args.eventId, profileId, recognition: "dev" });
    return profileId;
  },
});

/** Rename a Dev-added profile. */
export const updateProfile = mutation({
  args: { profileId: v.id("profiles"), name: v.string(), role: v.string() },
  handler: async (ctx, args): Promise<null> => {
    allow();
    const row = await managedProfile(ctx, args.profileId);
    const fields = validateProfile({ name: args.name, role: args.role, photoUrl: row.photoUrl });
    await ctx.db.patch(row._id, { name: fields.name, role: fields.role });
    return null;
  },
});

/**
 * Replace anyone's face scan, including a person who registered on their own device.
 * The operator confirms the person agreed, and a face that already matches someone
 * else is refused, so one person's scan cannot be handed to another's profile.
 */
export const saveScan = mutation({
  args: { ...scanArgs, profileId: v.id("profiles"), agreed: v.boolean() },
  handler: async (ctx, args): Promise<null> => {
    allow();
    if (!args.agreed) fail("Confirm the person agreed to be scanned and recognized.");
    const row = await ctx.db.get(args.profileId) ?? fail("That profile no longer exists.");
    const descriptors = checkedScan(args);
    await refuseDuplicate(ctx, descriptors, row._id);
    await saveTemplate(ctx, row._id, descriptors);
    return null;
  },
});

/** Delete anyone's face scan. They stop being recognized everywhere; their profile stays. */
export const deleteScan = mutation({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args): Promise<null> => {
    allow();
    const existing = await template(ctx, args.profileId);
    if (existing) await ctx.db.delete(existing._id);
    await clearSightings(ctx, args.profileId);
    return null;
  },
});

/** Remove a Dev-added profile entirely: scan, event places and the profile. */
export const deleteProfile = mutation({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args): Promise<null> => {
    allow();
    const row = await managedProfile(ctx, args.profileId);
    const existing = await template(ctx, row._id);
    if (existing) await ctx.db.delete(existing._id);
    await clearSightings(ctx, row._id);
    const memberships = await ctx.db.query("memberships").withIndex("by_profile", (q) => q.eq("profileId", row._id)).take(100);
    for (const membership of memberships) await ctx.db.delete(membership._id);
    await ctx.db.delete(row._id);
    return null;
  },
});

/** Put a Dev-added profile in an event (recognition only), or take it out. */
export const setEvent = mutation({
  args: { profileId: v.id("profiles"), eventId: v.id("events"), member: v.boolean() },
  handler: async (ctx, args): Promise<null> => {
    allow();
    const row = await managedProfile(ctx, args.profileId);
    if (!await ctx.db.get(args.eventId)) fail("That event no longer exists.");
    const existing = await ctx.db.query("memberships").withIndex("by_pair", (q) =>
      q.eq("eventId", args.eventId).eq("profileId", row._id)).unique();
    if (args.member && !existing) await ctx.db.insert("memberships", { eventId: args.eventId, profileId: row._id, recognition: "dev" });
    if (!args.member && existing) { await ctx.db.delete(existing._id); await clearSightings(ctx, row._id); }
    return null;
  },
});
