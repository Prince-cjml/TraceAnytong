import assert from "node:assert/strict";
import test from "node:test";
import { assertContentIndexEvidence, assertContentIndexPages, CONTENT_INDEX_VERSION, PAGE_FINGERPRINT_VERSION } from "./contentIndexRules.ts";

const page = {
  pageIndex: 0, previewStorageId: "_storage:preview", sourcePageSha256: "a".repeat(64), pHash: "0123456789abcdef", dHash: "fedcba9876543210",
  fingerprintVersion: PAGE_FINGERPRINT_VERSION, featureStorageId: "_storage:feature", featureSha256: "b".repeat(64), width: 1440, height: 1980,
};

test("content index pages are dense, bounded, and PII-free", () => {
  assert.doesNotThrow(() => assertContentIndexPages([page], true));
  assert.throws(() => assertContentIndexPages([{ ...page, pageIndex: 1 }], true), /INVALID_CONTENT_INDEX_PAGE/);
  assert.throws(() => assertContentIndexPages([{ ...page, dHash: "not-a-hash" }], true), /INVALID_CONTENT_INDEX_PAGE/);
  assert.throws(() => assertContentIndexPages([page], false), /UNINDEXED_CONTENT_MUST_NOT_HAVE_PAGES/);
});

test("content index evidence rejects arbitrary identifiers and source text", () => {
  assert.doesNotThrow(() => assertContentIndexEvidence({ indexVersion: CONTENT_INDEX_VERSION, input: { sha256: "a".repeat(64) }, result: { pageCount: 1 } }));
  assert.throws(() => assertContentIndexEvidence({ indexVersion: CONTENT_INDEX_VERSION, filename: "person.pdf" }), /INVALID_CONTENT_INDEX_EVIDENCE/);
});
