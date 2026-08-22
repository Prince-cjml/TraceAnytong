import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole, sameOrganization } from "./auth";
import { writeAuditEvent } from "./audit";
import { requireWorker } from "./workerAuth";

const decision = v.union(v.literal("attributed"), v.literal("insufficient"), v.literal("no_match"));

function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("INVALID_SHA256");
}

export const create = mutation({
  args: { evidenceStorageId: v.id("_storage"), evidenceSha256: v.string(), evidenceMime: v.string(), suspectedDocumentId: v.optional(v.id("documents")), protocolVersion: v.string(), detectorVersion: v.string(), fingerprintVersion: v.string() },
  handler: async (ctx, args) => {
    assertSha256(args.evidenceSha256);
    const reporter = await requireRole(ctx, ["investigator", "admin"]);
    if (args.suspectedDocumentId) {
      const document = await ctx.db.get(args.suspectedDocumentId);
      if (!document) throw new Error("NOT_FOUND");
      sameOrganization(document.orgId, reporter);
    }
    const caseId = await ctx.db.insert("traceCases", { ...args, orgId: reporter.orgId, reporterId: reporter._id, state: "queued", createdAt: Date.now() });
    await writeAuditEvent(ctx, { orgId: reporter.orgId, actorId: reporter._id, action: "trace_case.created", entityType: "traceCase", entityId: caseId, detailsHash: args.evidenceSha256 });
    return caseId;
  },
});

/** Workers submit the uncollapsed evidence vector; the server refuses ambiguous attribution. */
export const recordCandidate = mutation({
  args: {
    workerToken: v.string(), caseId: v.id("traceCases"), traceHandle: v.string(), issuanceId: v.optional(v.id("issuances")), webSessionId: v.optional(v.id("webSessions")),
    watermarkScore: v.number(), watermarkMargin: v.number(), fingerprintScore: v.number(), geometricScore: v.number(), structureScore: v.number(), timelineScore: v.number(),
    finalConfidence: v.number(), requestedDecision: decision, minimumConfidence: v.number(), minimumMargin: v.number(), explanation: v.string(), rawEvidence: v.any(), rank: v.number(),
    protocolVersion: v.string(), profileVersion: v.string(), carrierVersion: v.string(), detectorVersion: v.string(), fingerprintVersion: v.string(), keyVersion: v.string(),
    modelVersion: v.optional(v.string()), workerVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWorker(args.workerToken);
    const traceCase = await ctx.db.get(args.caseId);
    if (!traceCase) throw new Error("NOT_FOUND");
    const decisionValue = args.requestedDecision === "attributed" && args.finalConfidence >= args.minimumConfidence && args.watermarkMargin >= args.minimumMargin
      ? "attributed" as const
      : args.requestedDecision === "no_match" ? "no_match" as const : "insufficient" as const;
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
