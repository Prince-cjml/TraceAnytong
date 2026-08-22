import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEvidenceScores,
  assertRawEvidence,
  assertTraceHandle,
  parseTraceThresholds,
  resolveTraceDecision,
} from "./traceDecisionRules.ts";

const thresholds = { minimumConfidence: 0.8, minimumMargin: 0.05 };

test("server-owned thresholds cannot be bypassed into attribution", () => {
  assert.equal(resolveTraceDecision("attributed", 0.8, 0.05, thresholds), "attributed");
  assert.equal(resolveTraceDecision("attributed", 0.799, 0.2, thresholds), "insufficient");
  assert.equal(resolveTraceDecision("attributed", 0.99, 0.049, thresholds), "insufficient");
  assert.equal(resolveTraceDecision("attributed", Number.NaN, 0.2, thresholds), "insufficient");
  assert.equal(resolveTraceDecision("insufficient", 0.99, 0.2, thresholds), "insufficient");
  assert.equal(resolveTraceDecision("no_match", 0.99, 0.2, thresholds), "no_match");
});

test("trace candidate contracts reject malformed raw evidence, handles, thresholds, and scores", () => {
  assert.deepEqual(parseTraceThresholds(thresholds), thresholds);
  assert.throws(() => parseTraceThresholds({ minimumConfidence: 0.8 }), /INVALID_PROFILE_THRESHOLDS/);
  assert.throws(() => parseTraceThresholds({ minimumConfidence: -1, minimumMargin: 0.1 }), /INVALID_PROFILE_THRESHOLDS/);
  assert.doesNotThrow(() => assertRawEvidence({ peak: 0.92, geometry: { x: 4 } }));
  assert.throws(() => assertRawEvidence(null), /RAW_EVIDENCE_REQUIRED/);
  assert.throws(() => assertRawEvidence([]), /RAW_EVIDENCE_REQUIRED/);
  assert.doesNotThrow(() => assertTraceHandle("0123456789abcdef0123456789abcdef"));
  assert.throws(() => assertTraceHandle("recipient@example.com"), /INVALID_TRACE_HANDLE/);
  assert.doesNotThrow(() => assertEvidenceScores([0, 0.5, 1]));
  assert.throws(() => assertEvidenceScores([0.5, 1.01]), /INVALID_EVIDENCE_SCORE/);
});
