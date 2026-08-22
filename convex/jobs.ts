import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole, sameOrganization } from "./auth";
import { writeAuditEvent } from "./audit";
import { LEASE_DURATION_MS, completionDisposition, leaseIsActive, retryAt } from "./jobRules";
import { requireWorker } from "./workerAuth";

const workerClass = v.union(v.literal("cpu"), v.literal("gpu"), v.literal("hybrid"));
const MAX_ATTEMPTS = 4;

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
    const issuanceCandidates = traceCase && profile?.carrier !== "screen"
      ? await ctx.db.query("issuances").withIndex("by_org_profile", (q) => q.eq("orgId", traceCase.orgId).eq("profileId", job.profileId)).take(100)
      : [];
    const webSessionCandidates = traceCase && profile?.carrier === "screen"
      ? await ctx.db.query("webSessions").withIndex("by_org_profile_started", (q) => q.eq("orgId", traceCase.orgId).eq("profileId", job.profileId)).order("desc").take(100)
      : [];
    const issuanceBindings = await Promise.all(issuanceCandidates
      .filter((candidate) => candidate.status === "ready")
      .map(async (candidate) => {
        const candidateJob = candidate.jobId ? await ctx.db.get(candidate.jobId) : null;
        return {
          issuanceId: candidate._id,
          traceHandle: candidate.traceHandle,
          scope: "issuance",
          createdAt: candidate.issuedAt,
          wmCode: candidate.wmCode ?? null,
          outputSha256: candidateJob?.result?.outputSha256 ?? null,
        };
      }));
    const webSessionBindings = webSessionCandidates
      .filter((candidate) => candidate.tileStorageId !== undefined && candidate.expiresAt > now)
      .map((candidate) => ({
        webSessionId: candidate._id,
        traceHandle: candidate.traceHandle,
        scope: "web_session",
        createdAt: candidate.startedAt,
        wmCode: null,
        outputSha256: null,
      }));
    const candidates = [...issuanceBindings, ...webSessionBindings];
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
