/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const WORKER_TOKEN = "traceanytong-control-plane-handler-worker";
const PROFILE_ID = "screen-control-plane-profile-v1";
const PROFILE_VERSION = "1.0.0";
const PROTOCOL_VERSION = "0.1";
const CARRIER_VERSION = "screen-carrier-control-plane-v1";
const DETECTOR_VERSION = "screen-detector-control-plane-v1";
const FINGERPRINT_VERSION = "fingerprint-control-plane-v1";
const KEY_VERSION = "key-control-plane-v1";

process.env.WORKER_TOKEN = WORKER_TOKEN;

const modules = import.meta.glob([
  "./**/*.ts",
  "!./*.test.ts",
  "!./vitest.config.ts",
]);

type AccessFixture = {
  versionId: any;
  issuanceId: any;
  caseId: any;
  sessionId: any;
};

async function seedScreenUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const orgId = await ctx.db.insert("organizations", {
      name: "Session test organization", slug: `session-test-${subject}`, createdAt: now,
    });
    await ctx.db.insert("users", {
      orgId, authSubject: subject, displayName: "Session viewer", email: `${subject}@fixture.invalid`,
      role: "viewer", status: "active", createdAt: now,
    });
    await ctx.db.insert("watermarkProfiles", {
      profileId: PROFILE_ID, carrier: "screen", protocolVersion: PROTOCOL_VERSION,
      profileVersion: PROFILE_VERSION, carrierVersion: CARRIER_VERSION, detectorVersion: DETECTOR_VERSION,
      strength: 0.5, keyVersion: KEY_VERSION, thresholds: { minimumConfidence: 0.8, minimumMargin: 0.1 },
      status: "active", createdAt: now,
    });
  });
}

async function seedAccessFixture(t: ReturnType<typeof convexTest>): Promise<AccessFixture> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const sourceStorageId = await ctx.storage.store(new Blob(["source fixture"]));
    const issuedStorageId = await ctx.storage.store(new Blob(["issued fixture"]));
    const evidenceStorageId = await ctx.storage.store(new Blob(["evidence fixture"]));
    const tileStorageId = await ctx.storage.store(new Blob(["tile fixture"]));
    const orgId = await ctx.db.insert("organizations", {
      name: "Access owner organization", slug: "access-owner", createdAt: now,
    });
    const issuerId = await ctx.db.insert("users", {
      orgId, authSubject: "access-issuer", displayName: "Access issuer", email: "access-issuer@fixture.invalid",
      role: "issuer", status: "active", createdAt: now,
    });
    const recipientId = await ctx.db.insert("users", {
      orgId, authSubject: "access-recipient", displayName: "Access recipient", email: "access-recipient@fixture.invalid",
      role: "viewer", status: "active", createdAt: now,
    });
    await ctx.db.insert("users", {
      orgId, authSubject: "access-other-viewer", displayName: "Other viewer", email: "access-other@fixture.invalid",
      role: "viewer", status: "active", createdAt: now,
    });
    const documentId = await ctx.db.insert("documents", {
      orgId, title: "Access source", classification: "internal", ownerId: issuerId, createdAt: now, updatedAt: now,
    });
    const versionId = await ctx.db.insert("documentVersions", {
      documentId, sourceStorageId, sha256: "a".repeat(64), mime: "application/pdf", size: 14,
      fingerprintVersion: FINGERPRINT_VERSION, coarseFingerprint: "access-source", createdAt: now,
    });
    const issuanceId = await ctx.db.insert("issuances", {
      orgId, versionId, userId: recipientId, traceHandle: "0123456789abcdef0123456789abcdef",
      profileId: PROFILE_ID, derivedStorageId: issuedStorageId, status: "ready", issuedAt: now,
    });
    const caseId = await ctx.db.insert("traceCases", {
      orgId, evidenceStorageId, evidenceSha256: "b".repeat(64), evidenceMime: "image/png", reporterId: issuerId,
      state: "queued", protocolVersion: PROTOCOL_VERSION, detectorVersion: DETECTOR_VERSION,
      fingerprintVersion: FINGERPRINT_VERSION, createdAt: now,
    });
    const sessionId = await ctx.db.insert("webSessions", {
      orgId, userId: recipientId, traceHandle: "fedcba9876543210fedcba9876543210", routeScope: "/access",
      profileId: PROFILE_ID, epoch: 1, startedAt: now, expiresAt: now + 60_000, lastSeenAt: now,
      tileStorageId,
    });
    const otherOrgId = await ctx.db.insert("organizations", {
      name: "Access outsider organization", slug: "access-outsider", createdAt: now,
    });
    await ctx.db.insert("users", {
      orgId: otherOrgId, authSubject: "access-outsider", displayName: "Outsider", email: "access-outsider@fixture.invalid",
      role: "admin", status: "active", createdAt: now,
    });
    return { versionId, issuanceId, caseId, sessionId };
  });
}

describe("control-plane public handlers", () => {
  it("reuses a matching live protected session and separates an epoch change", async () => {
    const t = convexTest(schema, modules);
    await seedScreenUser(t, "session-viewer");
    const viewer = t.withIdentity({ subject: "session-viewer", email: "session-viewer@fixture.invalid" });
    const expiresAt = Date.now() + 60_000;

    const first = await viewer.mutation(api.webSessions.createOrReuse, {
      routeScope: "/workspace/reports", profileId: PROFILE_ID, epoch: 7, expiresAt,
    });
    const reused = await viewer.mutation(api.webSessions.createOrReuse, {
      routeScope: "/workspace/reports", profileId: PROFILE_ID, epoch: 7, expiresAt,
    });
    const nextEpoch = await viewer.mutation(api.webSessions.createOrReuse, {
      routeScope: "/workspace/reports", profileId: PROFILE_ID, epoch: 8, expiresAt,
    });

    expect(first.reused).toBe(false);
    expect(reused).toEqual({ sessionId: first.sessionId, traceHandle: first.traceHandle, reused: true });
    expect(nextEpoch.reused).toBe(false);
    expect(nextEpoch.sessionId).not.toEqual(first.sessionId);
    expect(nextEpoch.traceHandle).not.toEqual(first.traceHandle);
  });

  it("does not mint source, issuance, trace evidence, or session tile URLs to an unauthorized tenant or user", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAccessFixture(t);
    const outsider = t.withIdentity({ subject: "access-outsider", email: "access-outsider@fixture.invalid" });
    const otherViewer = t.withIdentity({ subject: "access-other-viewer", email: "access-other@fixture.invalid" });

    await expect(outsider.query(api.documents.getSourceDownloadUrl, { versionId: fixture.versionId })).rejects.toThrow("FORBIDDEN");
    await expect(outsider.query(api.issuances.getDownloadUrl, { issuanceId: fixture.issuanceId })).rejects.toThrow("FORBIDDEN");
    await expect(outsider.query(api.traceCases.getEvidenceDownloadUrl, { caseId: fixture.caseId })).rejects.toThrow("FORBIDDEN");
    await expect(outsider.query(api.webSessions.getTileDownloadUrl, { sessionId: fixture.sessionId })).rejects.toThrow("FORBIDDEN");

    await expect(otherViewer.query(api.issuances.getDownloadUrl, { issuanceId: fixture.issuanceId })).rejects.toThrow("FORBIDDEN");
    await expect(otherViewer.query(api.traceCases.getEvidenceDownloadUrl, { caseId: fixture.caseId })).rejects.toThrow("FORBIDDEN");
    await expect(otherViewer.query(api.webSessions.getTileDownloadUrl, { sessionId: fixture.sessionId })).rejects.toThrow("FORBIDDEN");
  });

  it("lists only the viewer's own bounded downloadable copies without trace bindings", async () => {
    const t = convexTest(schema, modules);
    await seedAccessFixture(t);
    const viewer = t.withIdentity({ subject: "access-recipient", email: "access-recipient@fixture.invalid" });
    const copies = await viewer.query(api.issuances.listAvailable, {});

    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ title: "Access source", status: "ready", ready: true });
    expect(Object.keys(copies[0])).not.toContain("traceHandle");
    expect(Object.keys(copies[0])).not.toContain("derivedStorageId");
  });

  it("makes duplicate completion idempotent only for the original output storage object", async () => {
    const t = convexTest(schema, modules);
    const job = await t.run(async (ctx) => {
      const now = Date.now();
      const inputStorageId = await ctx.storage.store(new Blob(["job input"]));
      const outputStorageId = await ctx.storage.store(new Blob(["job output"]));
      const conflictingOutputStorageId = await ctx.storage.store(new Blob(["other job output"]));
      const orgId = await ctx.db.insert("organizations", {
        name: "Completion organization", slug: "completion", createdAt: now,
      });
      const jobId = await ctx.db.insert("jobs", {
        orgId, jobKey: "handler-completion-job", type: "derive", inputStorageId, profileId: "completion-profile",
        state: "running", workerClass: "cpu", leaseOwner: "completion-worker", leaseExpiresAt: now + 60_000,
        nextAttemptAt: now, attempts: 1, createdAt: now, updatedAt: now,
      });
      return { jobId, outputStorageId, conflictingOutputStorageId };
    });
    const args = {
      workerToken: WORKER_TOKEN, workerId: "completion-worker", jobId: job.jobId,
      outputStorageId: job.outputStorageId, outputSha256: "c".repeat(64), result: { detector: "fixture-v1" },
    };

    await expect(t.mutation(api.jobs.complete, args)).resolves.toEqual({ status: "succeeded" });
    await expect(t.mutation(api.jobs.complete, args)).resolves.toEqual({ status: "already_succeeded" });
    await expect(t.mutation(api.jobs.complete, {
      ...args, outputStorageId: job.conflictingOutputStorageId,
    })).rejects.toThrow("DUPLICATE_COMPLETION_CONFLICT");
  });

  it("leases, validates, atomically completes, and exact-retries a source content index", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const [sourceStorageId, previewStorageId, featureStorageId, manifestStorageId, changedManifestStorageId] = await Promise.all([
        ctx.storage.store(new Blob(["source index fixture"])), ctx.storage.store(new Blob(["preview"])), ctx.storage.store(new Blob(["feature"])),
        ctx.storage.store(new Blob(["manifest"])), ctx.storage.store(new Blob(["changed manifest"])),
      ]);
      const orgId = await ctx.db.insert("organizations", { name: "Index organization", slug: "content-index", createdAt: now });
      const issuerId = await ctx.db.insert("users", { orgId, authSubject: "content-index-issuer", displayName: "Content index issuer", email: "content-index@fixture.invalid", role: "issuer", status: "active", createdAt: now });
      const documentId = await ctx.db.insert("documents", { orgId, title: "Indexed source", classification: "internal", ownerId: issuerId, createdAt: now, updatedAt: now });
      const versionId = await ctx.db.insert("documentVersions", {
        documentId, sourceStorageId, sha256: "a".repeat(64), mime: "image/png", size: 20, fingerprintVersion: "sha256-prefix-v1", coarseFingerprint: "a".repeat(32),
        contentIndexState: "processing", contentIndexVersion: "source-content-index-v1", createdAt: now,
      });
      const jobId = await ctx.db.insert("jobs", {
        orgId, jobKey: "content-index-job", type: "content_index", inputStorageId: sourceStorageId, versionId, contentIndexVersion: "source-content-index-v1",
        profileId: "source-content-index-v1", state: "running", workerClass: "cpu", leaseOwner: "content-index-worker", leaseExpiresAt: now + 60_000,
        nextAttemptAt: now, attempts: 1, createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(versionId, { contentIndexJobId: jobId });
      return { versionId, jobId, previewStorageId, featureStorageId, manifestStorageId, changedManifestStorageId };
    });
    const args = {
      workerToken: WORKER_TOKEN, workerId: "content-index-worker", jobId: fixture.jobId, versionId: fixture.versionId,
      manifestStorageId: fixture.manifestStorageId, manifestSha256: "c".repeat(64), sourceSha256: "a".repeat(64), status: "indexed" as const,
      indexVersion: "source-content-index-v1", warnings: [], rawEvidence: { indexVersion: "source-content-index-v1", input: { sha256: "a".repeat(64) }, result: { pageCount: 1 } },
      pages: [{ pageIndex: 0, previewStorageId: fixture.previewStorageId, sourcePageSha256: "b".repeat(64), pHash: "0123456789abcdef", dHash: "fedcba9876543210", fingerprintVersion: "perceptual-page-v1", featureStorageId: fixture.featureStorageId, featureSha256: "d".repeat(64), width: 100, height: 200 }],
    };
    await expect(t.mutation(api.jobs.complete, { workerToken: WORKER_TOKEN, workerId: "content-index-worker", jobId: fixture.jobId, result: {} })).rejects.toThrow("CONTENT_INDEX_REQUIRES_SPECIALIZED_COMPLETION");
    await expect(t.mutation(api.jobs.completeContentIndex, args)).resolves.toEqual({ status: "succeeded" });
    await expect(t.mutation(api.jobs.completeContentIndex, args)).resolves.toEqual({ status: "already_succeeded" });
    await expect(t.mutation(api.jobs.completeContentIndex, { ...args, manifestStorageId: fixture.changedManifestStorageId })).rejects.toThrow("DUPLICATE_COMPLETION_CONFLICT");
    const persisted = await t.run(async (ctx) => ({ version: await ctx.db.get(fixture.versionId), pages: await ctx.db.query("versionPages").withIndex("by_version_page", (q) => q.eq("versionId", fixture.versionId)).collect() }));
    expect(persisted.version).toMatchObject({ contentIndexState: "ready", contentIndexManifestSha256: "c".repeat(64), pageCount: 1 });
    expect(persisted.pages).toHaveLength(1);
    expect(persisted.pages[0]).toMatchObject({ pageIndex: 0, dHash: "fedcba9876543210" });
  });

  it("binds content-index lifecycle and worker input to one immutable source version", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const sourceStorageId = await ctx.storage.store(new Blob(["content-index source"]));
      const orgId = await ctx.db.insert("organizations", { name: "Index lifecycle organization", slug: "index-lifecycle", createdAt: now });
      const issuerId = await ctx.db.insert("users", { orgId, authSubject: "index-lifecycle-issuer", displayName: "Index lifecycle issuer", email: "index-lifecycle@fixture.invalid", role: "issuer", status: "active", createdAt: now });
      const documentId = await ctx.db.insert("documents", { orgId, title: "Index lifecycle source", classification: "internal", ownerId: issuerId, createdAt: now, updatedAt: now });
      const versionId = await ctx.db.insert("documentVersions", {
        documentId, sourceStorageId, sha256: "a".repeat(64), mime: "image/png", size: 20, fingerprintVersion: "sha256-prefix-v1", coarseFingerprint: "a".repeat(32),
        contentIndexState: "queued", contentIndexVersion: "source-content-index-v1", createdAt: now,
      });
      const jobId = await ctx.db.insert("jobs", {
        orgId, jobKey: "content-index-lifecycle-job", type: "content_index", inputStorageId: sourceStorageId, versionId, contentIndexVersion: "source-content-index-v1",
        profileId: "source-content-index-v1", state: "leased", workerClass: "cpu", leaseOwner: "content-index-lifecycle-worker", leaseExpiresAt: now + 60_000,
        nextAttemptAt: now, attempts: 1, createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(versionId, { contentIndexJobId: jobId });
      return { jobId, versionId };
    });

    await expect(t.mutation(api.jobs.start, { workerToken: WORKER_TOKEN, workerId: "content-index-lifecycle-worker", jobId: fixture.jobId })).resolves.toBeNull();
    const workerInput = await t.mutation(api.jobs.getWorkerInput, { workerToken: WORKER_TOKEN, workerId: "content-index-lifecycle-worker", jobId: fixture.jobId });
    expect(Object.keys(workerInput).sort()).toEqual(["indexVersion", "inputSha256", "inputUrl", "maxPages", "mime", "versionId"]);
    expect(workerInput).toMatchObject({ versionId: fixture.versionId, mime: "image/png", inputSha256: "a".repeat(64), indexVersion: "source-content-index-v1", maxPages: 200 });
    expect(await t.run(async (ctx) => (await ctx.db.get(fixture.versionId))?.contentIndexState)).toBe("processing");

    await expect(t.mutation(api.jobs.fail, {
      workerToken: WORKER_TOKEN, workerId: "content-index-lifecycle-worker", jobId: fixture.jobId, error: "INDEXER_FAILED", retryable: false,
    })).resolves.toBeNull();
    expect(await t.run(async (ctx) => (await ctx.db.get(fixture.versionId))?.contentIndexState)).toBe("failed");
  });

  it("derives initial source byte metadata and enqueues exactly one index job when adding a version", async () => {
    const t = convexTest(schema, modules);
    const setup = await t.run(async (ctx) => {
      const now = Date.now();
      const sourceStorageId = await ctx.storage.store(new Blob(["new immutable source"]));
      const orgId = await ctx.db.insert("organizations", { name: "Index enqueue organization", slug: "index-enqueue", createdAt: now });
      const issuerId = await ctx.db.insert("users", { orgId, authSubject: "index-enqueue-issuer", displayName: "Index enqueue issuer", email: "index-enqueue@fixture.invalid", role: "issuer", status: "active", createdAt: now });
      const documentId = await ctx.db.insert("documents", { orgId, title: "Index enqueue source", classification: "internal", ownerId: issuerId, createdAt: now, updatedAt: now });
      return { sourceStorageId, documentId };
    });
    const issuer = t.withIdentity({ subject: "index-enqueue-issuer", email: "index-enqueue@fixture.invalid" });
    const versionId = await issuer.mutation(api.documents.addVersion, {
      documentId: setup.documentId, sourceStorageId: setup.sourceStorageId, sha256: "b".repeat(64), mime: "image/png", size: 20,
      pageCount: 777, fingerprintVersion: "browser-controlled", coarseFingerprint: "browser-controlled",
    });
    const persisted = await t.run(async (ctx) => ({
      version: await ctx.db.get(versionId),
      allJobs: await ctx.db.query("jobs").collect(),
    }));
    expect(persisted.version).toMatchObject({
      fingerprintVersion: "sha256-prefix-v1", coarseFingerprint: "b".repeat(32), contentIndexState: "queued", contentIndexVersion: "source-content-index-v1",
    });
    expect(persisted.version?.pageCount).toBeUndefined();
    const indexJobs = persisted.allJobs.filter((job) => job.versionId === versionId && job.type === "content_index");
    expect(indexJobs).toHaveLength(1);
    expect(persisted.version?.contentIndexJobId).toEqual(indexJobs[0]._id);
  });

  it("recovers an expired active lease through the indexed recovery and retry path before it is claimable", async () => {
    const t = convexTest(schema, modules);
    const jobId = await t.run(async (ctx) => {
      const now = Date.now();
      const inputStorageId = await ctx.storage.store(new Blob(["expired lease input"]));
      const orgId = await ctx.db.insert("organizations", {
        name: "Recovery organization", slug: "recovery", createdAt: now,
      });
      return await ctx.db.insert("jobs", {
        orgId, jobKey: "handler-expired-lease", type: "derive", inputStorageId, profileId: "recovery-profile",
        state: "running", workerClass: "cpu", leaseOwner: "expired-worker", leaseExpiresAt: now - 1,
        nextAttemptAt: now, attempts: 1, createdAt: now, updatedAt: now,
      });
    });

    await expect(t.mutation(api.jobs.claim, {
      workerToken: WORKER_TOKEN, workerId: "recovery-worker", capabilities: ["cpu"],
    })).resolves.toBeNull();
    await expect(t.mutation(api.jobs.recoverExpiredLeases, { workerToken: WORKER_TOKEN })).resolves.toBe(1);
    await expect(t.mutation(api.jobs.requeueRetries, { workerToken: WORKER_TOKEN })).resolves.toBe(1);
    await expect(t.mutation(api.jobs.claim, {
      workerToken: WORKER_TOKEN, workerId: "recovery-worker", capabilities: ["cpu"],
    })).resolves.toMatchObject({ jobId, jobKey: "handler-expired-lease" });
  });
});
