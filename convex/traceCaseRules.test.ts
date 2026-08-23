import assert from "node:assert/strict";
import test from "node:test";
import { assertCandidateProfileMatchesTraceJob } from "./traceCaseRules.ts";

test("trace candidates must use the trace job's selected profile", () => {
  assert.doesNotThrow(() => assertCandidateProfileMatchesTraceJob("image-v1", "image-v1"));
  assert.throws(
    () => assertCandidateProfileMatchesTraceJob("image-v1", "screen-v1"),
    /CANDIDATE_PROFILE_MISMATCH/,
  );
});
