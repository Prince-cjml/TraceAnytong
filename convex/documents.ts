import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole, sameOrganization } from "./auth";
import { writeAuditEvent } from "./audit";
import { assertSupportedArtifactMime } from "./artifactRules";

const sha256 = v.string();
const SOURCE_CONTENT_INDEX_VERSION = "source-content-index-v1";
const CONTENT_INDEX_PROFILE_ID = "source-content-index-v1";
const SOURCE_BYTE_FINGERPRINT_VERSION = "sha256-prefix-v1";

async function contentIndexJobKey(versionId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`content-index|${versionId}|${SOURCE_CONTENT_INDEX_VERSION}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("INVALID_SHA256");
}

export const create = mutation({
  args: { title: v.string(), classification: v.string() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["issuer", "admin"]);
    const now = Date.now();
    const documentId = await ctx.db.insert("documents", {
      orgId: user.orgId, title: args.title, classification: args.classification, ownerId: user._id,
      createdAt: now, updatedAt: now,
    });
    await writeAuditEvent(ctx, { orgId: user.orgId, actorId: user._id, action: "document.created", entityType: "document", entityId: documentId, detailsHash: "metadata-only" });
    return documentId;
  },
});

/** Source versions are append-only. A new upload must create a new row and storage ID. */
export const addVersion = mutation({
  args: {
    documentId: v.id("documents"), sourceStorageId: v.id("_storage"), sha256, mime: v.string(), size: v.number(),
    pageCount: v.optional(v.number()), fingerprintVersion: v.string(), coarseFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    assertSha256(args.sha256);
    assertSupportedArtifactMime(args.mime);
    if (!Number.isInteger(args.size) || args.size < 0) throw new Error("INVALID_SIZE");
    const user = await requireRole(ctx, ["issuer", "admin"]);
    const document = await ctx.db.get(args.documentId);
    if (!document) throw new Error("NOT_FOUND");
    sameOrganization(document.orgId, user);
    const now = Date.now();
    // The browser supplies bytes and their claimed full digest for the worker
    // to verify. It must not choose metadata that later looks like a trusted
    // source index: the control plane names the initial byte fingerprint and
    // deterministically derives its compact display prefix from that digest.
    const versionId = await ctx.db.insert("documentVersions", {
      documentId: args.documentId, sourceStorageId: args.sourceStorageId, sha256: args.sha256,
      mime: args.mime, size: args.size, fingerprintVersion: SOURCE_BYTE_FINGERPRINT_VERSION,
      coarseFingerprint: args.sha256.slice(0, 32), contentIndexState: "queued",
      contentIndexVersion: SOURCE_CONTENT_INDEX_VERSION, createdAt: now,
    });
    const contentIndexJobId = await ctx.db.insert("jobs", {
      orgId: user.orgId, jobKey: await contentIndexJobKey(String(versionId)), type: "content_index", inputStorageId: args.sourceStorageId,
      versionId, contentIndexVersion: SOURCE_CONTENT_INDEX_VERSION, profileId: CONTENT_INDEX_PROFILE_ID, workerClass: "cpu",
      state: "queued", nextAttemptAt: now, attempts: 0, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(versionId, { contentIndexJobId });
    await ctx.db.patch(args.documentId, { currentVersionId: versionId, updatedAt: now });
    await writeAuditEvent(ctx, { orgId: user.orgId, actorId: user._id, action: "document.version_created", entityType: "documentVersion", entityId: versionId, detailsHash: args.sha256 });
    return versionId;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, ["viewer", "issuer", "investigator", "admin"]);
    return await ctx.db.query("documents").withIndex("by_org_updated", (q) => q.eq("orgId", user.orgId)).order("desc").take(100);
  },
});

export const getSourceDownloadUrl = query({
  args: { versionId: v.id("documentVersions") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["viewer", "issuer", "investigator", "admin"]);
    const version = await ctx.db.get(args.versionId);
    if (!version) return null;
    const document = await ctx.db.get(version.documentId);
    if (!document) return null;
    sameOrganization(document.orgId, user);
    // Authorization completes before this bearer URL is created.
    return await ctx.storage.getUrl(version.sourceStorageId);
  },
});
