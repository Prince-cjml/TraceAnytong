import assert from "node:assert/strict";
import test from "node:test";
import { assertSupportedArtifactMime, assertTraceProfileCompatibility, SUPPORTED_ARTIFACT_MIMES } from "./artifactRules.ts";

test("only worker-supported evidence formats enter immutable processing", () => {
  for (const mime of SUPPORTED_ARTIFACT_MIMES) assert.doesNotThrow(() => assertSupportedArtifactMime(mime));
  assert.throws(() => assertSupportedArtifactMime("image/gif"), /UNSUPPORTED_ARTIFACT_MIME/);
  assert.throws(() => assertSupportedArtifactMime("application/zip"), /UNSUPPORTED_ARTIFACT_MIME/);
});

test("trace intake pairs evidence with a detector that can inspect it", () => {
  for (const mime of ["image/jpeg", "image/png", "image/webp"] as const) {
    assert.doesNotThrow(() => assertTraceProfileCompatibility(mime, "image"));
    assert.doesNotThrow(() => assertTraceProfileCompatibility(mime, "screen"));
    assert.throws(() => assertTraceProfileCompatibility(mime, "structure"), /TRACE_PROFILE_MIME_MISMATCH/);
  }
  for (const mime of [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ] as const) {
    assert.doesNotThrow(() => assertTraceProfileCompatibility(mime, "screen"));
    assert.doesNotThrow(() => assertTraceProfileCompatibility(mime, "structure"));
    assert.throws(() => assertTraceProfileCompatibility(mime, "image"), /TRACE_PROFILE_MIME_MISMATCH/);
  }
});
