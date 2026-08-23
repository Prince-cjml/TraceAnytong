import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole, sameOrganization } from "./auth";
import { writeAuditEvent } from "./audit";
import { LEASE_DURATION_MS, completionDisposition, leaseIsActive, retryAt } from "./jobRules";
import { requireWorker } from "./workerAuth";
import { workerCandidatesFromSnapshot } from "./traceCandidateSnapshotRules";
import { assertContentIndexEvidence, assertContentIndexPages, CONTENT_INDEX_PROFILE_ID, CONTENT_INDEX_VERSION } from "./contentIndexRules";

const workerClass = v.union(v.literal("cpu"), v.literal("gpu"), v.literal("hybrid"));
const MAX_ATTEMPTS = 4;

/** Stable equality for an exact retry; storage IDs are represented as strings at this boundary. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const enqueue = mutation({
  args: { jobKey: v.string(), type: v.string(), inputStorageId: v.id("_storage"), profileId: v.string(), workerClass, issuanceId: v.optional(v.id("issuances")), caseId: v.optional(v.id("traceCases")) },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["issuer", "investigator", "admin"]);
    const existing = await ctx.db.query("jobs").withIndex("by_jobKey", (q) => q.eq("jobKey", args.jobKey)).unique();
    if (existing) {
      sameOrganization(existing.orgId, user);
      return { jobId: existing._id, created: false };
    }
    const now = Date.now();
    const jobId = await ctx.db.insert("jobs", { ...args, orgId: user.orgId, state: "queued", nextAttemptAt: now, attempts: 0, createdAt: now, updatedAt: now });
    await writeAuditEvent(ctx, { orgId: user.orgId, actorId: user._id, action: "job.enqueued", entityType: "job", entityId: jobId, detailsHash: args.jobKey });
    return { jobId, created: true };
  },
});

export const claim = mutation({
  args: { workerToken: v.string(), workerId: v.string(), capabilities: v.array(workerClass) },
  handler: async (ctx, args) => {
    requireWorker(args.workerToken);
    const now = Date.now();
    // Indexed, bounded scan: workers never enumerate the whole queue.
    const queued = await ctx.db.query("jobs").withIndex("by_state_nextAttemptAt", (q) => q.eq("state", "queued").lte("nextAttemptAt", now)).take(100);
    const job = queued.find((candidate) => args.capabilities.includes(candidate.workerClass));
    if (!job) return null;
    const leaseExpiresAt = now + LEASE_DURATION_MS;
    await ctx.db.patch(job._id, { state: "leased", leaseOwner: args.workerId, leaseExpiresAt, attempts: job.attempts + 1, updatedAt: now });
    return { jobId: job._id, jobKey: job.jobKey, type: job.type, inputStorageId: job.inputStorageId, profileId: job.profileId, issuanceId: job.issuanceId, caseId: job.caseId, webSessionId: job.webSessionId, leaseExpiresAt };
  },
});

export const start = mutation({
  args: { workerToken: v.string(), workerId: v.string(), jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    requireWorker(args.workerToken);
    const job = await ctx.db.get(args.jobId);
    const now = Date.now();
    if (!job || job.state !== "leased" || !leaseIsActive(job.leaseOwner, job.leaseExpiresAt, args.workerId, now)) throw new Error("LEASE_NOT_ACTIVE");
    await ctx.db.patch(args.jobId, { state: "running", updatedAt: now });
  },
});

/**
 * Returns a short-lived input URL only to the worker holding the active lease.
 * This is deliberately a mutation: the worker credential must never become a
 * browser-readable query argument.
 */
export const getWorkerInput = mutation({
  args: { workerToken: v.string(), workerId: v.string(), jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    requireWorker(args.workerToken);
    const job = await ctx.db.get(args.jobId);
    const now = Date.now();
    if (!job || (job.state !== "leased" && job.state !== "running") || !leaseIsActive(job.leaseOwner, job.leaseExpiresAt, args.workerId, now)) {
      throw new Error("LEASE_NOT_ACTIVE");
    }
    if (job.type === "content_index") {
      const version = job.versionId ? await ctx.db.get(job.versionId) : null;
      const inputUrl = job.inputStorageId ? await ctx.storage.getUrl(job.inputStorageId) : null;
      if (!version || !inputUrl || job.profileId !== CONTENT_INDEX_PROFILE_ID || job.contentIndexVersion !== CONTENT_INDEX_VERSION || version.contentIndexVersion !== CONTENT_INDEX_VERSION) {
        throw new Error("CONTENT_INDEX_INPUT_INVALID");
      }
      return {
        inputUrl, mime: version.mime, inputSha256: version.sha256, versionId: job.versionId,
        indexVersion: CONTENT_INDEX_VERSION, maxPages: 200, candidates: [],
      };
    }
    const [issuance, traceCase, webSession] = await Promise.all([
      job.issuanceId ? ctx.db.get(job.issuanceId) : null,
      job.caseId ? ctx.db.get(job.caseId) : null,
      job.webSessionId ? ctx.db.get(job.webSessionId) : null,
    ]);
    const [version, profile] = await Promise.all([
      issuance ? ctx.db.get(issuance.versionId) : null,
      ctx.db.query("watermarkProfiles").withIndex("by_profileId", (q) => q.eq("profileId", job.profileId)).unique(),
    ]);
    const inputUrl = job.inputStorageId ? await ctx.storage.getUrl(job.inputStorageId) : null;
    if (job.type !== "web_tile" && !inputUrl) throw new Error("INPUT_NOT_FOUND");
    if (job.type === "web_tile" && !webSession) throw new Error("WEB_SESSION_NOT_FOUND");
    if (job.type === "trace" && !job.traceCandidateSnapshot) throw new Error("TRACE_CANDIDATE_SNAPSHOT_MISSING");
    // Trace provenance is fixed at case creation. Never re-query changing live
    // issuance/session rows while a trace job waits in the queue.
    const candidates = job.type === "trace"
      ? workerCandidatesFromSnapshot(job.traceCandidateSnapshot!)
      : [];
    return {
      inputUrl,
      mime: version?.mime ?? traceCase?.evidenceMime ?? "image/png",
      inputSha256: version?.sha256 ?? traceCase?.evidenceSha256 ?? null,
      traceHandle: issuance?.traceHandle ?? webSession?.traceHandle ?? null,
      wmCode: issuance?.wmCode ?? null,
      profileId: job.profileId,
      profileCarrier: profile?.carrier ?? null,
      // The worker receives the exact immutable profile version and issuance time,
      // never a recipient identity.
      profileVersion: profile?.profileVersion ?? null,
      createdAt: issuance?.issuedAt ?? webSession?.startedAt ?? null,
      scope: issuance ? "issuance" : webSession ? "web_session" : null,
      issuanceId: job.issuanceId ?? null,
      caseId: job.caseId ?? null,
      candidates,
    };
  },
});

export const heartbeat = mutation({
  args: { workerToken: v.string(), workerId: v.string(), jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    requireWorker(args.workerToken);
    const job = await ctx.db.get(args.jobId);
    const now = Date.now();
    if (!job || (job.state !== "leased" && job.state !== "running") || !leaseIsActive(job.leaseOwner, job.leaseExpiresAt, args.workerId, now)) throw new Error("LEASE_NOT_ACTIVE");
    await ctx.db.patch(args.jobId, { leaseExpiresAt: now + LEASE_DURATION_MS, updatedAt: now });
  },
});

export const complete = mutation({
  args: { workerToken: v.string(), workerId: v.string(), jobId: v.id("jobs"), outputStorageId: v.optional(v.id("_storage")), outputSha256: v.optional(v.string()), result: v.any() },
  handler: async (ctx, args) => {
    requireWorker(args.workerToken);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("NOT_FOUND");
    if (job.type === "content_index") throw new Error("CONTENT_INDEX_REQUIRES_SPECIALIZED_COMPLETION");
    const disposition = completionDisposition(job.state, job.outputStorageId, args.outputStorageId);
    if (disposition === "idempotent") return { status: "already_succeeded" as const };
    if (disposition === "conflict") throw new Error("DUPLICATE_COMPLETION_CONFLICT");
    const now = Date.now();
    if (job.state !== "running" || !leaseIsActive(job.leaseOwner, job.leaseExpiresAt, args.workerId, now)) throw new Error("LEASE_NOT_ACTIVE");
    await ctx.db.patch(args.jobId, { state: "succeeded", outputStorageId: args.outputStorageId, result: { ...args.result, outputSha256: args.outputSha256 }, leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: now });
    if (job.issuanceId) {
      if (!args.outputStorageId) throw new Error("ISSUANCE_OUTPUT_REQUIRED");
      await ctx.db.patch(job.issuanceId, { status: "ready", derivedStorageId: args.outputStorageId });
    }
    if (job.webSessionId) {
      if (!args.outputStorageId) throw new Error("WEB_TILE_OUTPUT_REQUIRED");
      await ctx.db.patch(job.webSessionId, { tileStorageId: args.outputStorageId, lastSeenAt: now });
    }
    return { status: "succeeded" as const };
  },
});

/** Atomically binds a deterministic source-page index to its immutable version. */
export const completeContentIndex = mutation({
  args: {
    workerToken: v.string(), workerId: v.string(), jobId: v.id("jobs"), versionId: v.id("documentVersions"),
    manifestStorageId: v.id("_storage"), manifestSha256: v.string(), sourceSha256: v.string(),
    status: v.union(v.literal("indexed"), v.literal("unindexed")), indexVersion: v.string(), rawEvidence: v.any(), warnings: v.array(v.string()),
    pages: v.array(v.object({
      pageIndex: v.number(), previewStorageId: v.id("_storage"), sourcePageSha256: v.string(), pHash: v.string(), dHash: v.string(),
      fingerprintVersion: v.string(), featureStorageId: v.optional(v.id("_storage")), featureSha256: v.optional(v.string()), width: v.number(), height: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    requireWorker(args.workerToken);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.type !== "content_index" || job.versionId !== args.versionId || job.profileId !== CONTENT_INDEX_PROFILE_ID || job.contentIndexVersion !== CONTENT_INDEX_VERSION) throw new Error("CONTENT_INDEX_JOB_INVALID");
    const version = await ctx.db.get(args.versionId);
    if (!version || version.sha256 !== args.sourceSha256 || args.indexVersion !== CONTENT_INDEX_VERSION || !/^[a-f0-9]{64}$/.test(args.manifestSha256) || args.warnings.length > 20 || args.warnings.some((warning) => warning.length > 500)) throw new Error("CONTENT_INDEX_RESULT_INVALID");
    assertContentIndexPages(args.pages.map((page) => ({ ...page, previewStorageId: String(page.previewStorageId), featureStorageId: page.featureStorageId ? String(page.featureStorageId) : undefined })), args.status === "indexed");
    assertContentIndexEvidence(args.rawEvidence);
    const completionPayload = {
      indexVersion: args.indexVersion, sourceSha256: args.sourceSha256, status: args.status, warnings: args.warnings,
      rawEvidence: args.rawEvidence, pages: args.pages, manifestSha256: args.manifestSha256,
    };
    const completion = { ...completionPayload, completionFingerprint: stableJson(completionPayload) };
    const existing = job.outputStorageId;
    if (job.state === "succeeded") {
      if (existing === args.manifestStorageId && version.contentIndexManifestSha256 === args.manifestSha256 && job.result?.completionFingerprint === completion.completionFingerprint) return { status: "already_succeeded" as const };
      throw new Error("DUPLICATE_COMPLETION_CONFLICT");
    }
    const now = Date.now();
    if (job.state !== "running" || !leaseIsActive(job.leaseOwner, job.leaseExpiresAt, args.workerId, now)) throw new Error("LEASE_NOT_ACTIVE");
    for (const page of args.pages) await ctx.db.insert("versionPages", { versionId: args.versionId, ...page });
    await ctx.db.patch(args.versionId, {
      pageCount: args.pages.length, contentIndexState: "ready", contentIndexManifestStorageId: args.manifestStorageId,
      contentIndexManifestSha256: args.manifestSha256,
    });
    await ctx.db.patch(args.jobId, { state: "succeeded", outputStorageId: args.manifestStorageId, result: completion, leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: now });
    return { status: "succeeded" as const };
  },
});

export const fail = mutation({
  args: { workerToken: v.string(), workerId: v.string(), jobId: v.id("jobs"), error: v.string(), retryable: v.boolean() },
  handler: async (ctx, args) => {
    requireWorker(args.workerToken);
    const job = await ctx.db.get(args.jobId);
    const now = Date.now();
    if (!job || job.state !== "running" || !leaseIsActive(job.leaseOwner, job.leaseExpiresAt, args.workerId, now)) throw new Error("LEASE_NOT_ACTIVE");
    const shouldRetry = args.retryable && job.attempts < MAX_ATTEMPTS;
    await ctx.db.patch(args.jobId, {
      state: shouldRetry ? "retryable" : "failed", nextAttemptAt: shouldRetry ? retryAt(now, job.attempts) : now,
      lastError: args.error, leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: now,
    });
    if (job.issuanceId && !shouldRetry) await ctx.db.patch(job.issuanceId, { status: "failed" });
    if (job.caseId && !shouldRetry) await ctx.db.patch(job.caseId, { state: "failed", completedAt: now });
    if (job.type === "content_index" && job.versionId && !shouldRetry) await ctx.db.patch(job.versionId, { contentIndexState: "failed" });
  },
});

export const recoverExpiredLeases = mutation({
  args: { workerToken: v.string() },
  handler: async (ctx, args) => {
    requireWorker(args.workerToken);
    const now = Date.now();
    let recovered = 0;
    for (const state of ["leased", "running"] as const) {
      const jobs = await ctx.db.query("jobs").withIndex("by_state_leaseExpiresAt", (q) => q.eq("state", state).lte("leaseExpiresAt", now)).take(100);
      for (const job of jobs) {
        await ctx.db.patch(job._id, { state: "retryable", nextAttemptAt: now, leaseOwner: undefined, leaseExpiresAt: undefined, lastError: "LEASE_EXPIRED", updatedAt: now });
        recovered += 1;
      }
    }
    return recovered;
  },
});

export const requeueRetries = mutation({
  args: { workerToken: v.string() },
  handler: async (ctx, args) => {
    requireWorker(args.workerToken);
    const now = Date.now();
    const retries = await ctx.db.query("jobs").withIndex("by_state_nextAttemptAt", (q) => q.eq("state", "retryable").lte("nextAttemptAt", now)).take(100);
    for (const job of retries) await ctx.db.patch(job._id, { state: "queued", updatedAt: now });
    return retries.length;
  },
});
