import assert from "node:assert/strict";
import test from "node:test";
import { LEASE_DURATION_MS, completionDisposition, leaseIsActive, retryAt } from "./jobRules.ts";

test("expired leases are not active and retry timing is deterministic", () => {
  assert.equal(LEASE_DURATION_MS, 600_000);
  assert.equal(leaseIsActive("worker-a", 100, "worker-a", 100), false);
  assert.equal(leaseIsActive("worker-a", 101, "worker-a", 100), true);
  assert.deepEqual([1, 2, 3, 4].map((attempt) => retryAt(1_000, attempt)), [1_000, 31_000, 121_000, 601_000]);
});

test("duplicate completion is safe only when it reports the original output", () => {
  assert.equal(completionDisposition("succeeded", "storage-a", "storage-a"), "idempotent");
  assert.equal(completionDisposition("succeeded", "storage-a", "storage-b"), "conflict");
  assert.equal(completionDisposition("running", undefined, "storage-a"), "complete");
});
