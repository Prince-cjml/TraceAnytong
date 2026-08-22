import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { currentUser, requireRole, randomTraceHandle, sameOrganization } from "./auth";
import { writeAuditEvent } from "./audit";
import { canAccessSessionTile } from "./webSessionRules";

const MAX_SESSION_MS = 12 * 60 * 60 * 1000;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const createOrReuse = mutation({
  args: { routeScope: v.string(), profileId: v.string(), epoch: v.number(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const now = Date.now();
    if (!args.routeScope.startsWith("/") || args.expiresAt <= now || args.expiresAt > now + MAX_SESSION_MS) {
      throw new Error("INVALID_SESSION_BOUNDS");
    }
    const profile = await ctx.db.query("watermarkProfiles").withIndex("by_profileId", (q) => q.eq("profileId", args.profileId)).unique();
    if (!profile || profile.status !== "active" || profile.carrier !== "screen") throw new Error("INVALID_PROFILE");
    // A bounded recent scan prevents refreshes from creating uncontrolled session rows.
    const recent = await ctx.db.query("webSessions").withIndex("by_user_time", (q) => q.eq("userId", user._id)).order("desc").take(50);
    const reusable = recent.find((session) => session.routeScope === args.routeScope && session.profileId === args.profileId && session.epoch === args.epoch && session.expiresAt > now);
    if (reusable) {
      await ctx.db.patch(reusable._id, { lastSeenAt: now });
      return { sessionId: reusable._id, traceHandle: reusable.traceHandle, reused: true };
    }
    const sessionId = await ctx.db.insert("webSessions", {
      orgId: user.orgId, userId: user._id, traceHandle: randomTraceHandle(), routeScope: args.routeScope,
      profileId: args.profileId, epoch: args.epoch, startedAt: now, expiresAt: args.expiresAt, lastSeenAt: now,
    });
    const session = await ctx.db.get(sessionId);
    // Tiles are generated only by the worker. The browser receives a URL only
    // after `jobs.complete` atomically binds worker output to this session.
    await ctx.db.insert("jobs", {
      orgId: user.orgId, jobKey: await sha256Hex(`web_tile|${sessionId}`), type: "web_tile",
      webSessionId: sessionId, profileId: args.profileId, workerClass: "cpu", state: "queued",
      nextAttemptAt: now, attempts: 0, createdAt: now, updatedAt: now,
    });
    await writeAuditEvent(ctx, { orgId: user.orgId, actorId: user._id, action: "web_session.created", entityType: "webSession", entityId: sessionId, detailsHash: `${args.profileId}:${args.epoch}` });
    return { sessionId, traceHandle: session!.traceHandle, reused: false };
  },
});

export const heartbeat = mutation({
  args: { sessionId: v.id("webSessions") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("NOT_FOUND");
    sameOrganization(session.orgId, user);
    if (session.userId !== user._id) throw new Error("FORBIDDEN");
    if (session.expiresAt <= Date.now()) throw new Error("SESSION_EXPIRED");
    await ctx.db.patch(args.sessionId, { lastSeenAt: Date.now() });
  },
});

/**
 * Returns a bearer URL only after organization and session-recipient checks.
 * It returns pixels, not profile keys, seed material, or derivation inputs.
 */
export const getTileDownloadUrl = query({
  args: { sessionId: v.id("webSessions") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || !session.tileStorageId) return null;
    sameOrganization(session.orgId, user);
    if (!canAccessSessionTile(String(session.userId), String(user._id), user.role)) throw new Error("FORBIDDEN");
    return await ctx.storage.getUrl(session.tileStorageId);
  },
});

/** Investigator-only candidate source; trace handles remain anonymous here. */
export const candidatesForRoute = query({
  args: { routeScope: v.string(), after: v.number(), before: v.number() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["investigator", "admin"]);
    const sessions = await ctx.db.query("webSessions").withIndex("by_route_time", (q) => q.eq("orgId", user.orgId).eq("routeScope", args.routeScope).gte("startedAt", args.after).lte("startedAt", args.before)).take(500);
    return sessions.map(({ _id, traceHandle, profileId, epoch, startedAt, expiresAt, lastSeenAt }) => ({ _id, traceHandle, profileId, epoch, startedAt, expiresAt, lastSeenAt }));
  },
});
