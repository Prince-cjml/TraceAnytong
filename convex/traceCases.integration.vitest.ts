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
const SCREEN_PROFILE_ID = "screen-profile-integration-v1";
const SCREEN_TRACE_HANDLE = "00112233445566778899aabbccddeeff";
const SCREEN_ISSUANCE_TRACE_HANDLE = "11223344556677889900aabbccddeeff";
const OUTPUT_SHA256 = "a".repeat(64);
const OUTPUT_DHASH = "0123456789abcdef";
const SCREEN_OUTPUT_SHA256 = "c".repeat(64);
const FIXTURE_TIME = 1_725_000_000_000;
const FIXTURE_EXPIRY = 4_000_000_000_000;

process.env.WORKER_TOKEN = WORKER_TOKEN;

const modules = import.meta.glob([
  "./**/*.ts",
  "!./*.test.ts",
  "!./vitest.config.ts",
]);

type Seed = {
  caseEvidenceStorageId: any;
  candidateIssuanceId: any;
  candidateJobId: any;
  outOfSnapshotIssuanceId: any;
};

type ScreenSeed = {
  caseEvidenceStorageId: any;
  webSessionId: any;
  issuanceId: any;
};

async function seedTraceFixture(t: ReturnType<typeof convexTest>): Promise<Seed> {
  return t.run(async (ctx) => {
    const sourceStorageId = await ctx.storage.store(new Blob(["source"]));
    const derivedStorageId = await ctx.storage.store(new Blob(["derived"]));
    const caseEvidenceStorageId = await ctx.storage.store(new Blob(["evidence"]));
    const now = FIXTURE_TIME;
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
      nextAttemptAt: now, attempts: 1, result: {
        outputSha256: OUTPUT_SHA256,
        fingerprint: {
          fingerprintVersion: "perceptual-v1", sha256: OUTPUT_SHA256, mimeType: "image/png",
          dHash: OUTPUT_DHASH, width: 640, height: 480, bytes: 123_456,
        },
      }, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(candidateIssuanceId, { jobId: candidateJobId });
    return { caseEvidenceStorageId, candidateIssuanceId, candidateJobId, outOfSnapshotIssuanceId: undefined };
  });
}

async function seedScreenTraceFixture(t: ReturnType<typeof convexTest>): Promise<ScreenSeed> {
  return t.run(async (ctx) => {
    const caseEvidenceStorageId = await ctx.storage.store(new Blob(["screen evidence"]));
    const tileStorageId = await ctx.storage.store(new Blob(["screen tile"]));
    const sourceStorageId = await ctx.storage.store(new Blob(["screen issuance source"]));
    const derivedStorageId = await ctx.storage.store(new Blob(["screen issuance derived"]));
    const orgId = await ctx.db.insert("organizations", {
      name: "Screen Integration Organization", slug: "screen-integration-organization", createdAt: FIXTURE_TIME,
    });
    const reporterId = await ctx.db.insert("users", {
      orgId, authSubject: "screen-integration-investigator", displayName: "Screen Investigator",
      email: "screen-investigator@fixture.invalid", role: "investigator", status: "active", createdAt: FIXTURE_TIME,
    });
    const recipientId = await ctx.db.insert("users", {
      orgId, authSubject: "screen-integration-recipient", displayName: "Screen Recipient",
      email: "screen-recipient@fixture.invalid", role: "viewer", status: "active", createdAt: FIXTURE_TIME,
    });
    await ctx.db.insert("watermarkProfiles", {
      profileId: SCREEN_PROFILE_ID, carrier: "screen", protocolVersion: PROTOCOL_VERSION, profileVersion: PROFILE_VERSION,
      carrierVersion: CARRIER_VERSION, detectorVersion: DETECTOR_VERSION, strength: 0.5, keyVersion: KEY_VERSION,
      thresholds: { minimumConfidence: 0.8, minimumMargin: 0.1 }, status: "active", createdAt: FIXTURE_TIME,
    });
    const documentId = await ctx.db.insert("documents", {
      orgId, title: "Screen-issued source", classification: "internal", ownerId: reporterId,
      createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
    });
    const versionId = await ctx.db.insert("documentVersions", {
      documentId, sourceStorageId, sha256: "d".repeat(64), mime: "application/pdf", size: 22,
      fingerprintVersion: FINGERPRINT_VERSION, coarseFingerprint: "screen-issued-fixture", createdAt: FIXTURE_TIME,
    });
    const issuanceId = await ctx.db.insert("issuances", {
      orgId, versionId, userId: recipientId, traceHandle: SCREEN_ISSUANCE_TRACE_HANDLE,
      profileId: SCREEN_PROFILE_ID, derivedStorageId, status: "ready", issuedAt: FIXTURE_TIME + 1,
    });
    const issuanceJobId = await ctx.db.insert("jobs", {
      orgId, jobKey: "seeded-succeeded-screen-issuance", type: "personalize", inputStorageId: sourceStorageId,
      issuanceId, profileId: SCREEN_PROFILE_ID, state: "succeeded", workerClass: "cpu",
      nextAttemptAt: FIXTURE_TIME, attempts: 1, result: { outputSha256: SCREEN_OUTPUT_SHA256 },
      createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
    });
    await ctx.db.patch(issuanceId, { jobId: issuanceJobId });
    const webSessionId = await ctx.db.insert("webSessions", {
      orgId, userId: recipientId, traceHandle: SCREEN_TRACE_HANDLE, routeScope: "/screen-integration",
      profileId: SCREEN_PROFILE_ID, epoch: 1, startedAt: FIXTURE_TIME, expiresAt: FIXTURE_EXPIRY,
      lastSeenAt: FIXTURE_TIME, tileStorageId,
    });
    return { caseEvidenceStorageId, webSessionId, issuanceId };
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

function screenCandidateArgs(
  caseId: any,
  jobId: any,
  traceHandle: string,
  provenance: { issuanceId: any } | { webSessionId: any },
  rank: number,
  requestedDecision: "attributed" | "insufficient",
) {
  return {
    workerToken: WORKER_TOKEN, workerId: "screen-integration-worker", jobId, caseId,
    traceHandle, ...provenance,
    watermarkScore: 0.95, watermarkMargin: 0.2, fingerprintScore: 0.9, geometricScore: 0.8,
    structureScore: 0.7, timelineScore: 0.6, finalConfidence: 0.95, requestedDecision,
    explanation: "Raw screen correlation evidence supported this candidate.",
    rawEvidence: { correlationPeak: 0.95, phase: 4 }, rank,
    protocolVersion: PROTOCOL_VERSION, profileVersion: PROFILE_VERSION, carrierVersion: CARRIER_VERSION,
    detectorVersion: DETECTOR_VERSION, fingerprintVersion: FINGERPRINT_VERSION, keyVersion: KEY_VERSION,
    workerVersion: "screen-worker-integration-v1",
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

    // Live provenance and its worker result may change after queueing, but
    // worker input remains the case-time snapshot.
    const outOfSnapshotIssuanceId = await t.run(async (ctx) => {
      const original: any = await ctx.db.get(seed.candidateIssuanceId);
      if (!original) throw new Error("missing seed issuance");
      await ctx.db.patch(seed.candidateIssuanceId, { issuedAt: original.issuedAt + 99, wmCode: 99 });
      await ctx.db.patch(seed.candidateJobId, {
        result: {
          outputSha256: "e".repeat(64),
          fingerprint: {
            fingerprintVersion: "perceptual-v1", sha256: "e".repeat(64), mimeType: "image/png",
            dHash: "fedcba9876543210", width: 1, height: 1,
          },
        },
      });
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
      outputFingerprint: {
        fingerprintVersion: "perceptual-v1", sha256: OUTPUT_SHA256, mimeType: "image/png",
        dHash: OUTPUT_DHASH, width: 640, height: 480,
      },
    }]);
    expect(JSON.stringify(input.candidates)).not.toContain("recipient@integration.invalid");
    expect(input.candidates[0]).not.toHaveProperty("email");
    expect(input.candidates[0]).not.toHaveProperty("recipient");

    const firstCandidateArgs = candidateArgs(
      caseId, traceJob!._id, seed.candidateIssuanceId, SNAPSHOTTED_TRACE_HANDLE,
    );
    const firstCandidate = await t.mutation(api.traceCases.recordCandidate, firstCandidateArgs);
    expect(firstCandidate).toMatchObject({ decision: "attributed" });
    await expect(t.mutation(api.traceCases.recordCandidate, firstCandidateArgs)).resolves.toEqual(firstCandidate);
    await expect(t.mutation(api.traceCases.recordCandidate, {
      ...firstCandidateArgs,
      rawEvidence: { peaks: [0.94, 0.75], phase: 4 },
    })).rejects.toThrow("DUPLICATE_CANDIDATE_RANK");
    await expect(t.mutation(api.traceCases.recordCandidate, candidateArgs(
      caseId, traceJob!._id, outOfSnapshotIssuanceId, OUT_OF_SNAPSHOT_TRACE_HANDLE,
    ))).rejects.toThrow("TRACE_CANDIDATE_SNAPSHOT_MISMATCH");
  });

  it("enforces screen ranks through the live candidate-recording handler", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedScreenTraceFixture(t);
    const investigator = t.withIdentity({ subject: "screen-integration-investigator" });

    const caseId = await investigator.mutation(api.traceCases.create, {
      evidenceStorageId: seed.caseEvidenceStorageId, evidenceSha256: "d".repeat(64), evidenceMime: "image/png",
      profileId: SCREEN_PROFILE_ID, protocolVersion: PROTOCOL_VERSION, detectorVersion: DETECTOR_VERSION,
      fingerprintVersion: FINGERPRINT_VERSION,
    });
    const traceJob = await t.run(async (ctx) => (await ctx.db.query("jobs").collect()).find((job) => job.caseId === caseId));
    expect(traceJob).toBeDefined();

    // The input remains derived from the newly created job's immutable
    // bindings even if live issuance/session metadata changes before lease.
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.issuanceId, { issuedAt: FIXTURE_TIME + 9_999 });
      await ctx.db.patch(seed.webSessionId, { startedAt: FIXTURE_TIME + 9_998 });
    });

    const claimed = await t.mutation(api.jobs.claim, {
      workerToken: WORKER_TOKEN, workerId: "screen-integration-worker", capabilities: ["cpu"],
    });
    expect(claimed?.jobId).toEqual(traceJob!._id);
    await t.mutation(api.jobs.start, {
      workerToken: WORKER_TOKEN, workerId: "screen-integration-worker", jobId: traceJob!._id,
    });
    const input = await t.mutation(api.jobs.getWorkerInput, {
      workerToken: WORKER_TOKEN, workerId: "screen-integration-worker", jobId: traceJob!._id,
    });
    expect(input.candidates).toEqual([
      {
        traceHandle: SCREEN_ISSUANCE_TRACE_HANDLE, scope: "issuance", createdAt: FIXTURE_TIME + 1,
        issuanceId: seed.issuanceId, outputSha256: SCREEN_OUTPUT_SHA256,
      },
      {
        traceHandle: SCREEN_TRACE_HANDLE, scope: "web_session", createdAt: FIXTURE_TIME,
        webSessionId: seed.webSessionId,
      },
    ]);
    expect(JSON.stringify(input.candidates)).not.toContain("screen-recipient@fixture.invalid");
    expect(input.candidates.every((candidate) => !Object.hasOwn(candidate, "email"))).toBe(true);

    await expect(t.mutation(api.traceCases.recordCandidate, screenCandidateArgs(
      caseId, traceJob!._id, SCREEN_ISSUANCE_TRACE_HANDLE, { issuanceId: seed.issuanceId }, 1, "insufficient",
    ))).resolves.toMatchObject({ decision: "insufficient" });

    await expect(t.mutation(api.traceCases.recordCandidate, screenCandidateArgs(
      caseId, traceJob!._id, SCREEN_TRACE_HANDLE, { webSessionId: seed.webSessionId }, 2, "insufficient",
    ))).resolves.toMatchObject({ decision: "insufficient" });
    await expect(t.mutation(api.traceCases.recordCandidate, screenCandidateArgs(
      caseId, traceJob!._id, SCREEN_TRACE_HANDLE, { webSessionId: seed.webSessionId }, 2, "attributed",
    ))).rejects.toThrow("SCREEN_RUNNER_UP_ATTRIBUTION_FORBIDDEN");
    await expect(t.mutation(api.traceCases.recordCandidate, screenCandidateArgs(
      caseId, traceJob!._id, SCREEN_TRACE_HANDLE, { webSessionId: seed.webSessionId }, 3, "insufficient",
    ))).rejects.toThrow("SCREEN_CANDIDATE_RANK_LIMIT");
  });
});
