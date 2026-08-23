/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const WORKER_TOKEN = "traceanytong-integration-worker-token";
const PROFILE_ID = "image-profile-integration-v1";
const PROFILE_VERSION = "1.0.0";
const PROTOCOL_VERSION = "0.1";
const DETECTOR_VERSION = "detector-integration-v1";
const FINGERPRINT_VERSION = "fingerprint-integration-v1";
const CARRIER_VERSION = "carrier-integration-v1";
const KEY_VERSION = "key-integration-v1";
const SNAPSHOTTED_TRACE_HANDLE = "0123456789abcdef0123456789abcdef";
const OUT_OF_SNAPSHOT_TRACE_HANDLE = "fedcba9876543210fedcba9876543210";
const OUTPUT_SHA256 = "a".repeat(64);

process.env.WORKER_TOKEN = WORKER_TOKEN;

const modules = import.meta.glob([
  "./**/*.ts",
  "!./*.test.ts",
  "!./vitest.config.ts",
]);

type Seed = {
  caseEvidenceStorageId: any;
  candidateIssuanceId: any;
  outOfSnapshotIssuanceId: any;
};

async function seedTraceFixture(t: ReturnType<typeof convexTest>): Promise<Seed> {
  return t.run(async (ctx) => {
    const sourceStorageId = await ctx.storage.store(new Blob(["source"]));
    const derivedStorageId = await ctx.storage.store(new Blob(["derived"]));
    const caseEvidenceStorageId = await ctx.storage.store(new Blob(["evidence"]));
    const now = 1_725_000_000_000;
    const orgId = await ctx.db.insert("organizations", {
      name: "Integration Organization", slug: "integration-organization", createdAt: now,
    });
    const reporterId = await ctx.db.insert("users", {
      orgId, authSubject: "integration-investigator", displayName: "Investigator", email: "investigator@integration.invalid",
      role: "investigator", status: "active", createdAt: now,
    });
    const recipientId = await ctx.db.insert("users", {
      orgId, authSubject: "integration-recipient", displayName: "Recipient", email: "recipient@integration.invalid",
      role: "viewer", status: "active", createdAt: now,
    });
    const documentId = await ctx.db.insert("documents", {
      orgId, title: "Integration source", classification: "internal", ownerId: reporterId, createdAt: now, updatedAt: now,
    });
    const versionId = await ctx.db.insert("documentVersions", {
      documentId, sourceStorageId, sha256: "b".repeat(64), mime: "image/png", size: 6,
      fingerprintVersion: FINGERPRINT_VERSION, coarseFingerprint: "fixture", createdAt: now,
    });
    await ctx.db.insert("watermarkProfiles", {
      profileId: PROFILE_ID, carrier: "image", protocolVersion: PROTOCOL_VERSION, profileVersion: PROFILE_VERSION,
      carrierVersion: CARRIER_VERSION, detectorVersion: DETECTOR_VERSION, strength: 0.5, keyVersion: KEY_VERSION,
      thresholds: { minimumConfidence: 0.8, minimumMargin: 0.1 }, status: "active", createdAt: now,
    });
    const candidateIssuanceId = await ctx.db.insert("issuances", {
      orgId, versionId, userId: recipientId, traceHandle: SNAPSHOTTED_TRACE_HANDLE, wmCode: 42, profileId: PROFILE_ID,
      derivedStorageId, status: "ready", issuedAt: now,
    });
    const candidateJobId = await ctx.db.insert("jobs", {
      orgId, jobKey: "seeded-succeeded-candidate", type: "personalize", inputStorageId: sourceStorageId,
      issuanceId: candidateIssuanceId, profileId: PROFILE_ID, state: "succeeded", workerClass: "cpu",
      nextAttemptAt: now, attempts: 1, result: { outputSha256: OUTPUT_SHA256 }, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(candidateIssuanceId, { jobId: candidateJobId });
    return { caseEvidenceStorageId, candidateIssuanceId, outOfSnapshotIssuanceId: undefined };
  });
}

function candidateArgs(caseId: any, jobId: any, issuanceId: any, traceHandle: string) {
  return {
    workerToken: WORKER_TOKEN, workerId: "integration-worker", jobId, caseId, traceHandle, issuanceId,
    watermarkScore: 0.95, watermarkMargin: 0.2, fingerprintScore: 0.9, geometricScore: 0.8,
    structureScore: 0.7, timelineScore: 0.6, finalConfidence: 0.95, requestedDecision: "attributed" as const,
    explanation: "Raw detector evidence supported this candidate.", rawEvidence: { peaks: [0.95, 0.75], phase: 4 }, rank: 1,
    protocolVersion: PROTOCOL_VERSION, profileVersion: PROFILE_VERSION, carrierVersion: CARRIER_VERSION,
    detectorVersion: DETECTOR_VERSION, fingerprintVersion: FINGERPRINT_VERSION, keyVersion: KEY_VERSION,
    workerVersion: "worker-integration-v1",
  };
}

describe("trace case handlers", () => {
  it("freezes anonymous candidate bindings for a live leased trace job", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTraceFixture(t);
    const investigator = t.withIdentity({ subject: "integration-investigator", email: "investigator@integration.invalid" });

    const caseId = await investigator.mutation(api.traceCases.create, {
      evidenceStorageId: seed.caseEvidenceStorageId, evidenceSha256: "c".repeat(64), evidenceMime: "image/png",
      profileId: PROFILE_ID, protocolVersion: PROTOCOL_VERSION, detectorVersion: DETECTOR_VERSION,
      fingerprintVersion: FINGERPRINT_VERSION,
    });
    const traceJob = await t.run(async (ctx) => (await ctx.db.query("jobs").collect()).find((job) => job.caseId === caseId));
    expect(traceJob).toBeDefined();

    // Live provenance may change or new same-profile copies may be created after queueing.
    const outOfSnapshotIssuanceId = await t.run(async (ctx) => {
      const original: any = await ctx.db.get(seed.candidateIssuanceId);
      if (!original) throw new Error("missing seed issuance");
      await ctx.db.patch(seed.candidateIssuanceId, { issuedAt: original.issuedAt + 99, wmCode: 99 });
      return ctx.db.insert("issuances", {
        ...original, _id: undefined, _creationTime: undefined, traceHandle: OUT_OF_SNAPSHOT_TRACE_HANDLE,
        wmCode: 100, issuedAt: original.issuedAt + 100, jobId: undefined,
      } as any);
    });

    const claimed = await t.mutation(api.jobs.claim, {
      workerToken: WORKER_TOKEN, workerId: "integration-worker", capabilities: ["cpu"],
    });
    expect(claimed?.jobId).toEqual(traceJob!._id);
    await t.mutation(api.jobs.start, { workerToken: WORKER_TOKEN, workerId: "integration-worker", jobId: traceJob!._id });
    const input = await t.mutation(api.jobs.getWorkerInput, {
      workerToken: WORKER_TOKEN, workerId: "integration-worker", jobId: traceJob!._id,
    });

    expect(input.candidates).toEqual([{
      traceHandle: SNAPSHOTTED_TRACE_HANDLE, scope: "issuance", createdAt: 1_725_000_000_000,
      issuanceId: seed.candidateIssuanceId, wmCode: 42, outputSha256: OUTPUT_SHA256,
    }]);
    expect(JSON.stringify(input.candidates)).not.toContain("recipient@integration.invalid");
    expect(input.candidates[0]).not.toHaveProperty("email");
    expect(input.candidates[0]).not.toHaveProperty("recipient");

    await expect(t.mutation(api.traceCases.recordCandidate, candidateArgs(
      caseId, traceJob!._id, seed.candidateIssuanceId, SNAPSHOTTED_TRACE_HANDLE,
    ))).resolves.toMatchObject({ decision: "attributed" });
    await expect(t.mutation(api.traceCases.recordCandidate, candidateArgs(
      caseId, traceJob!._id, seed.candidateIssuanceId, SNAPSHOTTED_TRACE_HANDLE,
    ))).rejects.toThrow("DUPLICATE_CANDIDATE_RANK");
    await expect(t.mutation(api.traceCases.recordCandidate, candidateArgs(
      caseId, traceJob!._id, outOfSnapshotIssuanceId, OUT_OF_SNAPSHOT_TRACE_HANDLE,
    ))).rejects.toThrow("TRACE_CANDIDATE_SNAPSHOT_MISMATCH");
  });
});
