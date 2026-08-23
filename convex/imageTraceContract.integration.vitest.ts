/// <reference types="vite/client" />

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const WORKER_TOKEN = "local-contract-worker-token";
const FIXTURE_TIME = 1_725_000_000_000;
const TRACE_HANDLE = "0123456789abcdef0123456789abcdef";
const bridgePath = "services/watermark-worker/tests/trace_contract_bridge.py";

process.env.WORKER_TOKEN = WORKER_TOKEN;

const modules = import.meta.glob([
  "./**/*.ts",
  "!./*.test.ts",
  "!./vitest.config.ts",
]);

type BridgeFixture = {
  profile: {
    profileId: string;
    profileVersion: string;
    keyVersion: string;
    carrierVersion: string;
    detectorVersion: string;
    fingerprintVersion: string;
  };
  candidate: {
    traceHandle: string;
    scope: "issuance";
    createdAt: number;
    wmCode: number;
    outputSha256: string;
    outputFingerprint: Record<string, unknown>;
  };
  evidenceBase64: string;
  evidenceSha256: string;
};

function bridge(command: "build"): BridgeFixture;
function bridge(command: "run", payload: object): { outcome: { status: string }; candidate: Record<string, unknown> };
function bridge(command: "build" | "run", payload?: object) {
  const result = spawnSync("python", [bridgePath, command], {
    cwd: process.cwd(),
    input: payload ? JSON.stringify(payload) : undefined,
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (result.status !== 0) {
    throw new Error(`trace contract bridge failed: ${result.stderr || result.stdout}`);
  }
  // Optional worker dependencies can print a deprecation warning while the
  // package imports. The bridge itself emits exactly one JSON line last.
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!);
}

async function seedAndLease(
  t: ReturnType<typeof convexTest>,
  fixture: BridgeFixture,
  fingerprint: Record<string, unknown>,
) {
  const ids = await t.run(async (ctx) => {
    const sourceStorageId = await ctx.storage.store(new Blob(["source"]));
    const derivedStorageId = await ctx.storage.store(new Blob(["derived"]));
    const evidenceStorageId = await ctx.storage.store(new Blob(["evidence"]));
    const orgId = await ctx.db.insert("organizations", {
      name: "Local contract organization", slug: "local-contract-organization",
      createdAt: FIXTURE_TIME,
    });
    const investigatorId = await ctx.db.insert("users", {
      orgId, authSubject: "local-contract-investigator",
      displayName: "Local Contract Investigator", email: "local-contract-investigator@fixture.invalid",
      role: "investigator", status: "active", createdAt: FIXTURE_TIME,
    });
    const recipientId = await ctx.db.insert("users", {
      orgId, authSubject: "local-contract-recipient",
      displayName: "Local Contract Recipient", email: "local-contract-recipient@fixture.invalid",
      role: "viewer", status: "active", createdAt: FIXTURE_TIME,
    });
    const documentId = await ctx.db.insert("documents", {
      orgId, title: "Local contract source", classification: "internal", ownerId: investigatorId,
      createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
    });
    const versionId = await ctx.db.insert("documentVersions", {
      documentId, sourceStorageId, sha256: "b".repeat(64), mime: "image/png", size: 6,
      fingerprintVersion: fixture.profile.fingerprintVersion, coarseFingerprint: "local-contract-source", createdAt: FIXTURE_TIME,
    });
    await ctx.db.insert("watermarkProfiles", {
      profileId: fixture.profile.profileId, carrier: "image", protocolVersion: "0.1",
      profileVersion: fixture.profile.profileVersion, carrierVersion: fixture.profile.carrierVersion,
      detectorVersion: fixture.profile.detectorVersion, strength: 0.12, keyVersion: fixture.profile.keyVersion,
      // The image carrier's deterministic visual detector emits 0.76 for
      // this JPEG/resize fixture; its independent fingerprint gate is 0.90.
      // This immutable test profile makes the server-owned confidence floor
      // explicit rather than treating a worker request as a decision.
      thresholds: { minimumConfidence: 0.7, minimumMargin: 0.1 }, status: "active", createdAt: FIXTURE_TIME,
    });
    const issuanceId = await ctx.db.insert("issuances", {
      orgId, versionId, userId: recipientId, traceHandle: TRACE_HANDLE, wmCode: fixture.candidate.wmCode,
      profileId: fixture.profile.profileId, derivedStorageId, status: "ready", issuedAt: FIXTURE_TIME,
    });
    const personalizeJobId = await ctx.db.insert("jobs", {
      orgId, jobKey: "local-contract-personalize",
      type: "personalize", inputStorageId: sourceStorageId, issuanceId, profileId: fixture.profile.profileId,
      state: "succeeded", workerClass: "cpu", nextAttemptAt: FIXTURE_TIME, attempts: 1,
      result: { outputSha256: fixture.candidate.outputSha256, fingerprint }, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
    });
    await ctx.db.patch(issuanceId, { jobId: personalizeJobId });
    return { evidenceStorageId, investigatorSubject: (await ctx.db.get(investigatorId))!.authSubject, issuanceId };
  });

  const investigator = t.withIdentity({ subject: ids.investigatorSubject });
  const caseId = await investigator.mutation(api.traceCases.create, {
    evidenceStorageId: ids.evidenceStorageId, evidenceSha256: fixture.evidenceSha256, evidenceMime: "image/jpeg",
    profileId: fixture.profile.profileId, protocolVersion: "0.1", detectorVersion: fixture.profile.detectorVersion,
    fingerprintVersion: fixture.profile.fingerprintVersion,
  });
  const traceJob = await t.run(async (ctx) => (await ctx.db.query("jobs").collect()).find((job) => job.caseId === caseId));
  expect(traceJob).toBeDefined();
  const claimed = await t.mutation(api.jobs.claim, {
    workerToken: WORKER_TOKEN, workerId: "local-contract-worker", capabilities: ["cpu"],
  });
  expect(claimed?.jobId).toEqual(traceJob!._id);
  await t.mutation(api.jobs.start, {
    workerToken: WORKER_TOKEN, workerId: "local-contract-worker", jobId: traceJob!._id,
  });
  const workerInput = await t.mutation(api.jobs.getWorkerInput, {
    workerToken: WORKER_TOKEN, workerId: "local-contract-worker", jobId: traceJob!._id,
  });
  return { caseId, jobId: traceJob!._id, issuanceId: ids.issuanceId, workerInput };
}

describe("local visual image trace contract", () => {
  it("projects the frozen fingerprint into the real worker and accepts its transformed-raster attribution", async () => {
    const fixture = bridge("build");
    const t = convexTest(schema, modules);
    const lease = await seedAndLease(t, fixture, fixture.candidate.outputFingerprint);
    expect(lease.workerInput.candidates).toEqual([{
      ...fixture.candidate,
      issuanceId: lease.issuanceId,
      // The projection intentionally removes non-comparison metadata such as
      // byte length while retaining the immutable perceptual comparison keys.
      outputFingerprint: {
        fingerprintVersion: fixture.candidate.outputFingerprint.fingerprintVersion,
        sha256: fixture.candidate.outputFingerprint.sha256,
        mimeType: fixture.candidate.outputFingerprint.mimeType,
        dHash: fixture.candidate.outputFingerprint.dHash,
        width: fixture.candidate.outputFingerprint.width,
        height: fixture.candidate.outputFingerprint.height,
      },
    }]);

    const result = bridge("run", {
      profile: fixture.profile,
      workerInput: { ...lease.workerInput, jobId: lease.jobId, caseId: lease.caseId },
      evidenceBase64: fixture.evidenceBase64,
    });
    expect(result.outcome.status).toBe("succeeded");
    expect(result.candidate).toMatchObject({
      caseId: lease.caseId, traceHandle: TRACE_HANDLE, issuanceId: lease.issuanceId,
      requestedDecision: "attributed", rank: 1,
    });
    expect(result.candidate.finalConfidence).toBeGreaterThanOrEqual(0.7);
    expect(result.candidate.watermarkMargin).toBeGreaterThanOrEqual(0.1);
    expect((result.candidate.rawEvidence as any).imageCarrier.raw.recovery).toBe("visual-raster");
    expect((result.candidate.rawEvidence as any).attributionGate).toMatchObject({
      exactOutputSha256: false, visualRasterRecovery: true, perceptualFingerprintSupported: true,
    });

    await expect(t.mutation(api.traceCases.recordCandidate, {
      workerToken: WORKER_TOKEN, workerId: "local-contract-worker", jobId: lease.jobId,
      ...result.candidate,
    } as any)).resolves.toMatchObject({ decision: "attributed" });
  }, 20_000);

  it("retains the same visual code as insufficient when the frozen fingerprint is mismatched", async () => {
    const fixture = bridge("build");
    const mismatched = { ...fixture.candidate.outputFingerprint, dHash: "0".repeat(16) };
    const t = convexTest(schema, modules);
    const lease = await seedAndLease(t, fixture, mismatched);
    const result = bridge("run", {
      profile: fixture.profile,
      workerInput: { ...lease.workerInput, jobId: lease.jobId, caseId: lease.caseId },
      evidenceBase64: fixture.evidenceBase64,
    });
    expect(result.outcome.status).toBe("succeeded");
    expect(result.candidate).toMatchObject({ requestedDecision: "insufficient", rank: 1 });
    expect((result.candidate.rawEvidence as any).imageCarrier.raw.recovery).toBe("visual-raster");
    expect((result.candidate.rawEvidence as any).attributionGate).toMatchObject({
      exactOutputSha256: false, visualRasterRecovery: true, perceptualFingerprintSupported: false,
    });

    await expect(t.mutation(api.traceCases.recordCandidate, {
      workerToken: WORKER_TOKEN, workerId: "local-contract-worker", jobId: lease.jobId,
      ...result.candidate,
    } as any)).resolves.toMatchObject({ decision: "insufficient" });
  }, 20_000);
});
