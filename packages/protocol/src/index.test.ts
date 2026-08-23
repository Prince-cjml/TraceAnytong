import assert from "node:assert/strict";
import test from "node:test";
import { assertTraceHandle, canTransitionJob, decideTrace, PAGE_FINGERPRINT_VERSION, retryDelayMs, SOURCE_CONTENT_INDEX_VERSION, type SourceIndexManifest } from "./index.ts";

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

test("source index manifests describe pages without provenance identity fields", () => {
  const manifest: SourceIndexManifest = {
    indexVersion: SOURCE_CONTENT_INDEX_VERSION,
    sourceSha256: "a".repeat(64),
    mimeType: "application/pdf",
    pages: [{ pageIndex: 0, sourcePageSha256: "b".repeat(64), pHash: "0123456789abcdef", dHash: "fedcba9876543210", width: 1440, height: 1980, fingerprintVersion: PAGE_FINGERPRINT_VERSION }],
    warnings: [],
  };
  assert.deepEqual(Object.keys(manifest.pages[0]).sort(), ["dHash", "fingerprintVersion", "height", "pHash", "pageIndex", "sourcePageSha256", "width"]);
  assert.equal(JSON.stringify(manifest).includes("traceHandle"), false);
});
