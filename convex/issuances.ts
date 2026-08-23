import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole, randomTraceHandle, sameOrganization } from "./auth";
import { writeAuditEvent } from "./audit";
import { assertPersonalizationCompatibility, assertRecipientIsActive } from "./issuanceRules";

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uniqueWmCode(ctx: any): Promise<number> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const input = new Uint32Array(1);
    crypto.getRandomValues(input);
    const wmCode = input[0];
    const existing = await ctx.db.query("issuances").withIndex("by_wmCode", (q: any) => q.eq("wmCode", wmCode)).unique();
    if (!existing) return wmCode;
  }
  throw new Error("WMCODE_ALLOCATION_FAILED");
}

export const create = mutation({
  args: {
    versionId: v.id("documentVersions"), recipientUserId: v.id("users"), profileId: v.string(), outputFormat: v.string(),
    workerClass: v.union(v.literal("cpu"), v.literal("gpu"), v.literal("hybrid")),
  },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["issuer", "admin"]);
    const [version, recipient, profile] = await Promise.all([
      ctx.db.get(args.versionId), ctx.db.get(args.recipientUserId),
      ctx.db.query("watermarkProfiles").withIndex("by_profileId", (q) => q.eq("profileId", args.profileId)).unique(),
    ]);
    if (!version || !recipient || !profile || profile.status !== "active") throw new Error("NOT_FOUND");
    assertRecipientIsActive(recipient.status);
    sameOrganization(recipient.orgId, actor);
    const document = await ctx.db.get(version.documentId);
    if (!document) throw new Error("NOT_FOUND");
    sameOrganization(document.orgId, actor);
    assertPersonalizationCompatibility({
      sourceMime: version.mime,
      outputFormat: args.outputFormat,
      carrier: profile.carrier,
    });

    const traceHandle = randomTraceHandle();
    // Only the image carrier receives a model-sized code. The trace handle remains 128-bit for every carrier.
    const wmCode = profile.carrier === "image" ? await uniqueWmCode(ctx) : undefined;
    const now = Date.now();
    const issuanceId = await ctx.db.insert("issuances", {
      orgId: actor.orgId, versionId: args.versionId, userId: args.recipientUserId, traceHandle, wmCode,
      profileId: args.profileId, status: "queued", issuedAt: now,
    });
    const jobKey = await sha256Hex(`${version.sha256}|${traceHandle}|${args.profileId}|${args.outputFormat}`);
    const jobId = await ctx.db.insert("jobs", {
      orgId: actor.orgId, jobKey, type: "personalize", inputStorageId: version.sourceStorageId, issuanceId,
      profileId: args.profileId, state: "queued", workerClass: args.workerClass, nextAttemptAt: now,
      attempts: 0, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(issuanceId, { jobId });
    await writeAuditEvent(ctx, { orgId: actor.orgId, actorId: actor._id, action: "issuance.created", entityType: "issuance", entityId: issuanceId, detailsHash: jobKey });
    return { issuanceId, jobId, traceHandle, wmCode };
  },
});

export const getDownloadUrl = query({
  args: { issuanceId: v.id("issuances") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["viewer", "issuer", "investigator", "admin"]);
    const issuance = await ctx.db.get(args.issuanceId);
    if (!issuance || issuance.status !== "ready" || !issuance.derivedStorageId) return null;
    sameOrganization(issuance.orgId, user);
    if (issuance.userId !== user._id && user.role !== "issuer" && user.role !== "investigator" && user.role !== "admin") {
      throw new Error("FORBIDDEN");
    }
    return await ctx.storage.getUrl(issuance.derivedStorageId);
  },
});

export const markDownloaded = mutation({
  args: { issuanceId: v.id("issuances") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["viewer", "issuer", "investigator", "admin"]);
    const issuance = await ctx.db.get(args.issuanceId);
    if (!issuance || issuance.status !== "ready") throw new Error("NOT_FOUND");
    sameOrganization(issuance.orgId, user);
    if (issuance.userId !== user._id && user.role !== "admin") throw new Error("FORBIDDEN");
    await ctx.db.patch(args.issuanceId, { downloadedAt: Date.now() });
  },
});
