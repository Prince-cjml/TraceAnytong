import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCandidateInTraceSnapshot,
  assertTraceCandidateSnapshot,
  MAX_TRACE_CANDIDATES,
  workerCandidatesFromSnapshot,
  type TraceCandidateSnapshotBinding,
} from "./traceCandidateSnapshotRules.ts";

const issuanceBinding: TraceCandidateSnapshotBinding = {
  traceHandle: "0123456789abcdef0123456789abcdef",
  scope: "issuance",
  createdAt: 1_725_000_000_000,
  issuanceId: "issuances:immutable",
  wmCode: 42,
  outputSha256: "a".repeat(64),
};

const sessionBinding: TraceCandidateSnapshotBinding = {
  traceHandle: "fedcba9876543210fedcba9876543210",
  scope: "web_session",
  createdAt: 1_725_000_000_001,
  webSessionId: "webSessions:immutable",
};

test("trace candidate snapshots are bounded anonymous bindings with no PII fields", () => {
  const snapshot = [issuanceBinding, sessionBinding];
  assert.doesNotThrow(() => assertTraceCandidateSnapshot(snapshot));
  assert.throws(
    () => assertTraceCandidateSnapshot(Array.from({ length: MAX_TRACE_CANDIDATES + 1 }, () => issuanceBinding)),
    /TRACE_CANDIDATE_SNAPSHOT_LIMIT_EXCEEDED/,
  );
  assert.throws(
    () => assertTraceCandidateSnapshot([{ ...issuanceBinding, email: "not-permitted@example.test" } as any]),
    /INVALID_TRACE_CANDIDATE_SNAPSHOT/,
  );
  for (const candidate of workerCandidatesFromSnapshot(snapshot)) {
    assert.deepEqual(Object.keys(candidate).sort(), candidate.scope === "issuance"
      ? ["createdAt", "issuanceId", "outputSha256", "scope", "traceHandle", "wmCode"]
      : ["createdAt", "scope", "traceHandle", "webSessionId"]);
    assert.equal("email" in candidate, false);
    assert.equal("recipient" in candidate, false);
    assert.equal("url" in candidate, false);
    assert.equal("secret" in candidate, false);
  }
});

test("worker input is reused from the stored snapshot rather than mutable live provenance", () => {
  const snapshot = [issuanceBinding];
  const changedLiveRow = {
    ...issuanceBinding,
    traceHandle: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    wmCode: 99,
    outputSha256: "b".repeat(64),
  };
  const workerCandidates = workerCandidatesFromSnapshot(snapshot);
  assert.deepEqual(workerCandidates, snapshot);
  assert.notDeepEqual(workerCandidates[0], changedLiveRow);
});

test("candidate submission rejects a same-profile but out-of-snapshot binding", () => {
  const snapshot = [issuanceBinding, sessionBinding];
  assert.doesNotThrow(() => assertCandidateInTraceSnapshot(snapshot, {
    traceHandle: issuanceBinding.traceHandle,
    issuanceId: issuanceBinding.issuanceId,
  }));
  assert.throws(() => assertCandidateInTraceSnapshot(snapshot, {
    traceHandle: issuanceBinding.traceHandle,
    issuanceId: "issuances:same-profile-but-not-snapshotted",
  }), /TRACE_CANDIDATE_SNAPSHOT_MISMATCH/);
  assert.throws(() => assertCandidateInTraceSnapshot(snapshot, {
    traceHandle: issuanceBinding.traceHandle,
    webSessionId: issuanceBinding.issuanceId,
  }), /TRACE_CANDIDATE_SNAPSHOT_MISMATCH/);
});
