import assert from "node:assert/strict";
import test from "node:test";
import { assertTraceHandle, canTransitionJob, decideTrace, retryDelayMs } from "./index.ts";

test("trace handles have a fixed opaque 128-bit representation", () => {
  assert.equal(assertTraceHandle("0123456789abcdef0123456789abcdef"), "0123456789abcdef0123456789abcdef");
  assert.throws(() => assertTraceHandle("person@example.com"));
  assert.throws(() => assertTraceHandle("abc"));
});

test("job transitions and retry policy are explicit", () => {
  assert.equal(canTransitionJob("queued", "leased"), true);
  assert.equal(canTransitionJob("queued", "succeeded"), false);
  assert.equal(canTransitionJob("running", "retryable"), true);
  assert.deepEqual([1, 2, 3, 4].map(retryDelayMs), [0, 30_000, 120_000, 600_000]);
});

test("ambiguous detector evidence never produces attribution", () => {
  assert.equal(decideTrace(0.94, 0.93, 0.8, 0.05), "insufficient");
  assert.equal(decideTrace(0.94, 0.6, 0.8, 0.05), "attributed");
  assert.equal(decideTrace(0.4, undefined, 0.8, 0.05), "insufficient");
});
