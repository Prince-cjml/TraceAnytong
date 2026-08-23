import assert from "node:assert/strict";
import test from "node:test";
import { MAX_TRACE_CANDIDATES } from "./traceCandidateSnapshotRules.ts";
import { assertCandidateRank, assertCandidateRankForCarrier } from "./traceRankRules.ts";

test("trace candidate ranks are positive integers bounded by the shared candidate limit", () => {
  assert.doesNotThrow(() => assertCandidateRank(1));
  assert.doesNotThrow(() => assertCandidateRank(MAX_TRACE_CANDIDATES));
  for (const invalidRank of [0, -1, 1.5, Number.NaN, MAX_TRACE_CANDIDATES + 1]) {
    assert.throws(() => assertCandidateRank(invalidRank), /INVALID_CANDIDATE_RANK/);
  }
});

test("screen trace candidates retain only first and second rank with no runner-up attribution", () => {
  assert.doesNotThrow(() => assertCandidateRankForCarrier(1, "screen", "attributed"));
  assert.doesNotThrow(() => assertCandidateRankForCarrier(2, "screen", "insufficient"));
  assert.doesNotThrow(() => assertCandidateRankForCarrier(2, "screen", "no_match"));
  assert.throws(
    () => assertCandidateRankForCarrier(2, "screen", "attributed"),
    /SCREEN_RUNNER_UP_ATTRIBUTION_FORBIDDEN/,
  );
  assert.throws(() => assertCandidateRankForCarrier(3, "screen", "insufficient"), /SCREEN_CANDIDATE_RANK_LIMIT/);
});

test("non-screen carriers retain existing server threshold decision handling at every valid rank", () => {
  assert.doesNotThrow(() => assertCandidateRankForCarrier(1, "image", "attributed"));
  assert.doesNotThrow(() => assertCandidateRankForCarrier(2, "image", "attributed"));
  assert.doesNotThrow(() => assertCandidateRankForCarrier(2, "structure", "attributed"));
});
