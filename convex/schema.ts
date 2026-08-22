import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const role = v.union(v.literal("viewer"), v.literal("issuer"), v.literal("investigator"), v.literal("admin"));
const userStatus = v.union(v.literal("active"), v.literal("disabled"));
const jobState = v.union(
  v.literal("queued"),
  v.literal("leased"),
  v.literal("running"),
  v.literal("retryable"),
  v.literal("succeeded"),
  v.literal("failed"),
);
const traceDecision = v.union(v.literal("attributed"), v.literal("insufficient"), v.literal("no_match"));

export default defineSchema({
  organizations: defineTable({
    name: v.string(), slug: v.string(), policyId: v.optional(v.string()), createdAt: v.number(),
  }).index("by_slug", ["slug"]),
  users: defineTable({
    orgId: v.id("organizations"), authSubject: v.string(), displayName: v.string(),
    email: v.string(), role, status: userStatus, createdAt: v.number(),
  }).index("by_org_subject", ["orgId", "authSubject"]).index("by_authSubject", ["authSubject"])
    .index("by_org_role", ["orgId", "role"]).index("by_org_status", ["orgId", "status"]),
  organizationInvitations: defineTable({
    orgId: v.id("organizations"), email: v.string(), role: v.union(v.literal("viewer"), v.literal("issuer"), v.literal("investigator")),
    invitedBy: v.id("users"), status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked")),
    createdAt: v.number(), expiresAt: v.number(), acceptedAt: v.optional(v.number()), acceptedUserId: v.optional(v.id("users")),
  }).index("by_email_status", ["email", "status"]).index("by_org_email_status", ["orgId", "email", "status"]),
  documents: defineTable({
    orgId: v.id("organizations"), title: v.string(), classification: v.string(), ownerId: v.id("users"),
    currentVersionId: v.optional(v.id("documentVersions")), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_org_updated", ["orgId", "updatedAt"]),
  documentVersions: defineTable({
    documentId: v.id("documents"), sourceStorageId: v.id("_storage"), sha256: v.string(), mime: v.string(), size: v.number(),
    pageCount: v.optional(v.number()), fingerprintVersion: v.string(), coarseFingerprint: v.string(), createdAt: v.number(),
  }).index("by_document_created", ["documentId", "createdAt"]).index("by_sha256", ["sha256"]),
  versionPages: defineTable({
    versionId: v.id("documentVersions"), pageIndex: v.number(), previewStorageId: v.id("_storage"), pHash: v.string(),
    featureStorageId: v.optional(v.id("_storage")), width: v.number(), height: v.number(),
  }).index("by_version_page", ["versionId", "pageIndex"]),
  watermarkProfiles: defineTable({
    profileId: v.string(), carrier: v.union(v.literal("image"), v.literal("screen"), v.literal("structure")),
    protocolVersion: v.string(), profileVersion: v.string(), carrierVersion: v.string(), modelVersion: v.optional(v.string()), detectorVersion: v.string(),
    strength: v.number(), tileConfig: v.optional(v.any()), keyVersion: v.string(), thresholds: v.any(),
    status: v.union(v.literal("active"), v.literal("retired")), createdAt: v.number(),
  }).index("by_profileId", ["profileId"]),
  issuances: defineTable({
    orgId: v.id("organizations"), versionId: v.id("documentVersions"), userId: v.id("users"), traceHandle: v.string(),
    wmCode: v.optional(v.number()), profileId: v.string(), derivedStorageId: v.optional(v.id("_storage")),
    jobId: v.optional(v.id("jobs")), status: v.union(v.literal("queued"), v.literal("processing"), v.literal("ready"), v.literal("failed")),
    issuedAt: v.number(), downloadedAt: v.optional(v.number()),
  }).index("by_traceHandle", ["traceHandle"]).index("by_wmCode", ["wmCode"])
    .index("by_version_user", ["versionId", "userId"]).index("by_version_time", ["versionId", "issuedAt"])
    .index("by_org_profile", ["orgId", "profileId"]),
  webSessions: defineTable({
    orgId: v.id("organizations"), userId: v.id("users"), traceHandle: v.string(), routeScope: v.string(), profileId: v.string(),
    epoch: v.number(), startedAt: v.number(), expiresAt: v.number(), lastSeenAt: v.number(), tileStorageId: v.optional(v.id("_storage")),
  }).index("by_traceHandle", ["traceHandle"]).index("by_route_time", ["orgId", "routeScope", "startedAt"])
    .index("by_user_time", ["userId", "startedAt"])
    .index("by_org_profile_started", ["orgId", "profileId", "startedAt"]),
  jobs: defineTable({
    orgId: v.id("organizations"), jobKey: v.string(), type: v.string(), inputStorageId: v.optional(v.id("_storage")),
    outputStorageId: v.optional(v.id("_storage")), issuanceId: v.optional(v.id("issuances")), caseId: v.optional(v.id("traceCases")), webSessionId: v.optional(v.id("webSessions")),
    profileId: v.string(), state: jobState, workerClass: v.union(v.literal("cpu"), v.literal("gpu"), v.literal("hybrid")),
    leaseOwner: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()), nextAttemptAt: v.number(), attempts: v.number(),
    lastError: v.optional(v.string()), result: v.optional(v.any()), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_jobKey", ["jobKey"]).index("by_webSessionId", ["webSessionId"]).index("by_state_nextAttemptAt", ["state", "nextAttemptAt"])
    .index("by_state_leaseExpiresAt", ["state", "leaseExpiresAt"]),
  traceCases: defineTable({
    orgId: v.id("organizations"), evidenceStorageId: v.id("_storage"), evidenceSha256: v.string(), evidenceMime: v.string(),
    reporterId: v.id("users"), suspectedDocumentId: v.optional(v.id("documents")),
    state: v.union(v.literal("queued"), v.literal("processing"), v.literal("complete"), v.literal("failed")),
    protocolVersion: v.string(), detectorVersion: v.string(), fingerprintVersion: v.string(), workerVersion: v.optional(v.string()),
    createdAt: v.number(), completedAt: v.optional(v.number()),
  }).index("by_org_created", ["orgId", "createdAt"]),
  traceCandidates: defineTable({
    caseId: v.id("traceCases"), traceHandle: v.string(), issuanceId: v.optional(v.id("issuances")), webSessionId: v.optional(v.id("webSessions")),
    watermarkScore: v.number(), watermarkMargin: v.number(), fingerprintScore: v.number(), geometricScore: v.number(), structureScore: v.number(), timelineScore: v.number(),
    finalConfidence: v.number(), decision: traceDecision, explanation: v.string(), rawEvidence: v.any(), rank: v.number(),
    protocolVersion: v.string(), profileVersion: v.string(), carrierVersion: v.string(), detectorVersion: v.string(), fingerprintVersion: v.string(), keyVersion: v.string(),
    modelVersion: v.optional(v.string()), workerVersion: v.optional(v.string()),
  }).index("by_case_rank", ["caseId", "rank"]),
  auditEvents: defineTable({
    orgId: v.id("organizations"), actorId: v.optional(v.id("users")), action: v.string(), entityType: v.string(), entityId: v.string(),
    detailsHash: v.string(), time: v.number(),
  }).index("by_org_time", ["orgId", "time"]),
});
