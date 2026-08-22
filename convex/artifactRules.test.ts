import assert from "node:assert/strict";
import test from "node:test";
import { assertSupportedArtifactMime, SUPPORTED_ARTIFACT_MIMES } from "./artifactRules.ts";

test("only worker-supported evidence formats enter immutable processing", () => {
  for (const mime of SUPPORTED_ARTIFACT_MIMES) assert.doesNotThrow(() => assertSupportedArtifactMime(mime));
  assert.throws(() => assertSupportedArtifactMime("image/gif"), /UNSUPPORTED_ARTIFACT_MIME/);
  assert.throws(() => assertSupportedArtifactMime("application/zip"), /UNSUPPORTED_ARTIFACT_MIME/);
});
