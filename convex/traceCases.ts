import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole, sameOrganization } from "./auth";
import { writeAuditEvent } from "./audit";
import { requireWorker } from "./workerAuth";
import { assertEvidenceScores, assertRawEvidence, assertTraceHandle, parseTraceThresholds, resolveTraceDecision } from "./traceDecisionRules";

const decision = v.union(v.literal("attributed"), v.literal("insufficient"), v.literal("no_match"));

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("INVALID_SHA256");
}

export const create = mutation({
  args: { evidenceStorageId: v.id("_storage"), evidenceSha256: v.string(), evidenceMime: v.string(), profileId: v.string(), suspectedDocumentId: v.optional(v.id("documents")), protocolVersion: v.string(), detectorVersion: v.string(), fingerprintVersion: v.string() },
  handler: async (ctx, args) => {
    assertSha256(args.evidenceSha256);
    const reporter = await requireRole(ctx, ["investigator", "admin"]);
    if (args.suspectedDocumentId) {
      const document = await ctx.db.get(args.suspectedDocumentId);
      if (!document) throw new Error("NOT_FOUND");
      sameOrganization(document.orgId, reporter);
    }
    const profile = await ctx.db.query("watermarkProfiles").withIndex("by_profileId", (q) => q.eq("profileId", args.profileId)).unique();
    if (!profile || profile.status !== "active") throw new Error("INVALID_PROFILE");
    if (profile.protocolVersion !== args.protocolVersion) throw new Error("PROFILE_PROTOCOL_MISMATCH");
    const now = Date.now();
    const { profileId: _profileId, ...caseArgs } = args;
    const caseId = await ctx.db.insert("traceCases", { ...caseArgs, orgId: reporter.orgId, reporterId: reporter._id, state: "queued", createdAt: now });
    await ctx.db.insert("jobs", {
      orgId: reporter.orgId, jobKey: await sha256Hex(`trace|${caseId}|${args.profileId}`), type: "trace",
      inputStorageId: args.evidenceStorageId, caseId, profileId: args.profileId, workerClass: "cpu",
      state: "queued", nextAttemptAt: now, attempts: 0, createdAt: now, updatedAt: now,
    });
    await writeAuditEvent(ctx, { orgId: reporter.orgId, actorId: reporter._id, action: "trace_case.created", entityType: "traceCase", entityId: caseId, detailsHash: args.evidenceSha256 });
    return caseId;
  },
});

/** Workers submit the uncollapsed evidence vector; the server refuses ambiguous attribution. */
export const recordCandidate = mutation({
  args: {
    workerToken: v.string(), caseId: v.id("traceCases"), traceHandle: v.string(), issuanceId: v.optional(v.id("issuances")), webSessionId: v.optional(v.id("webSessions")),
    watermarkScore: v.number(), watermarkMargin: v.number(), fingerprintScore: v.number(), geometricScore: v.number(), structureScore: v.number(), timelineScore: v.number(),
    finalConfidence: v.number(), requestedDecision: decision, explanation: v.string(), rawEvidence: v.any(), rank: v.number(),
    protocolVersion: v.string(), profileVersion: v.string(), carrierVersion: v.string(), detectorVersion: v.string(), fingerprintVersion: v.string(), keyVersion: v.string(),
    modelVersion: v.optional(v.string()), workerVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWorker(args.workerToken);
    const traceCase = await ctx.db.get(args.caseId);
    if (!traceCase) throw new Error("NOT_FOUND");
    assertTraceHandle(args.traceHandle);
    assertRawEvidence(args.rawEvidence);
    assertEvidenceScores([
      args.watermarkScore, args.watermarkMargin, args.fingerprintScore, args.geometricScore,
      args.structureScore, args.timelineScore, args.finalConfidence,
    ]);
    if (!Number.isInteger(args.rank) || args.rank < 1) throw new Error("INVALID_RANK");
    if ((args.issuanceId ? 1 : 0) + (args.webSessionId ? 1 : 0) !== 1) throw new Error("CANDIDATE_PROVENANCE_REQUIRED");

    const issuance = args.issuanceId ? await ctx.db.get(args.issuanceId) : null;
    const webSession = args.webSessionId ? await ctx.db.get(args.webSessionId) : null;
    const provenance = issuance ?? webSession;
    if (!provenance || provenance.orgId !== traceCase.orgId || provenance.traceHandle !== args.traceHandle) {
      throw new Error("CANDIDATE_PROVENANCE_MISMATCH");
    }
    const profile = await ctx.db.query("watermarkProfiles").withIndex("by_profileId", (q) => q.eq("profileId", provenance.profileId)).unique();
    if (!profile || profile.status !== "active" || profile.profileVersion !== args.profileVersion || profile.protocolVersion !== args.protocolVersion) {
      throw new Error("CANDIDATE_PROFILE_MISMATCH");
    }
    const thresholds = parseTraceThresholds(profile.thresholds);
    const decisionValue = resolveTraceDecision(args.requestedDecision, args.finalConfidence, args.watermarkMargin, thresholds);
    const candidateId = await ctx.db.insert("traceCandidates", {
      caseId: args.caseId, traceHandle: args.traceHandle, issuanceId: args.issuanceId, webSessionId: args.webSessionId,
      watermarkScore: args.watermarkScore, watermarkMargin: args.watermarkMargin, fingerprintScore: args.fingerprintScore,
      geometricScore: args.geometricScore, structureScore: args.structureScore, timelineScore: args.timelineScore,
      finalConfidence: args.finalConfidence, decision: decisionValue, explanation: args.explanation, rawEvidence: args.rawEvidence, rank: args.rank,
      protocolVersion: args.protocolVersion, profileVersion: args.profileVersion, carrierVersion: args.carrierVersion,
      detectorVersion: args.detectorVersion, fingerprintVersion: args.fingerprintVersion, keyVersion: args.keyVersion,
      modelVersion: args.modelVersion, workerVersion: args.workerVersion,
    });
    if (traceCase.state === "queued") await ctx.db.patch(args.caseId, { state: "processing", workerVersion: args.workerVersion });
    return { candidateId, decision: decisionValue };
  },
});

export const complete = mutation({
  args: { workerToken: v.string(), caseId: v.id("traceCases"), failed: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    requireWorker(args.workerToken);
    const traceCase = await ctx.db.get(args.caseId);
    if (!traceCase) throw new Error("NOT_FOUND");
    await ctx.db.patch(args.caseId, { state: args.failed ? "failed" : "complete", completedAt: Date.now() });
  },
});

export const get = query({
  args: { caseId: v.id("traceCases") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["investigator", "admin"]);
    const traceCase = await ctx.db.get(args.caseId);
    if (!traceCase) return null;
    sameOrganization(traceCase.orgId, user);
    const candidates = await ctx.db.query("traceCandidates").withIndex("by_case_rank", (q) => q.eq("caseId", args.caseId)).take(100);
    return { ...traceCase, candidates };
  },
});

/** Investigator work queue with Convex's opaque, stable pagination cursor. */
export const list = query({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["investigator", "admin"]);
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) throw new Error("INVALID_LIMIT");
    const result = await ctx.db.query("traceCases")
      .withIndex("by_org_created", (q) => q.eq("orgId", user.orgId))
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: args.limit });
    return {
      cases: result.page.map((traceCase) => ({
        _id: traceCase._id,
        state: traceCase.state,
        evidenceSha256: traceCase.evidenceSha256,
        evidenceMime: traceCase.evidenceMime,
        suspectedDocumentId: traceCase.suspectedDocumentId,
        protocolVersion: traceCase.protocolVersion,
        detectorVersion: traceCase.detectorVersion,
        fingerprintVersion: traceCase.fingerprintVersion,
        workerVersion: traceCase.workerVersion,
        createdAt: traceCase.createdAt,
        completedAt: traceCase.completedAt,
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const getEvidenceDownloadUrl = query({
  args: { caseId: v.id("traceCases") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["investigator", "admin"]);
    const traceCase = await ctx.db.get(args.caseId);
    if (!traceCase) return null;
    sameOrganization(traceCase.orgId, user);
    return await ctx.storage.getUrl(traceCase.evidenceStorageId);
  },
});
