export type RequestedTraceDecision = "attributed" | "insufficient" | "no_match";

export type TraceThresholds = { minimumConfidence: number; minimumMargin: number };

/**
 * The detector may request a disposition, but it cannot lower server-owned
 * profile thresholds or convert ambiguous evidence into an attribution.
 */
export function resolveTraceDecision(
  requestedDecision: RequestedTraceDecision,
  finalConfidence: number,
  watermarkMargin: number,
  thresholds: TraceThresholds,
): RequestedTraceDecision {
  if (requestedDecision !== "attributed") return requestedDecision;
  if (!Number.isFinite(finalConfidence) || !Number.isFinite(watermarkMargin)) return "insufficient";
  if (!Number.isFinite(thresholds.minimumConfidence) || !Number.isFinite(thresholds.minimumMargin)) return "insufficient";
  if (thresholds.minimumConfidence < 0 || thresholds.minimumMargin < 0) return "insufficient";
  return finalConfidence >= thresholds.minimumConfidence && watermarkMargin >= thresholds.minimumMargin
    ? "attributed"
    : "insufficient";
}

export function parseTraceThresholds(value: unknown): TraceThresholds {
  if (!value || typeof value !== "object") throw new Error("INVALID_PROFILE_THRESHOLDS");
  const { minimumConfidence, minimumMargin } = value as Record<string, unknown>;
  if (typeof minimumConfidence !== "number" || typeof minimumMargin !== "number"
    || !Number.isFinite(minimumConfidence) || !Number.isFinite(minimumMargin)
    || minimumConfidence < 0 || minimumMargin < 0) {
    throw new Error("INVALID_PROFILE_THRESHOLDS");
  }
  return { minimumConfidence, minimumMargin };
}

export function assertRawEvidence(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("RAW_EVIDENCE_REQUIRED");
}

export function assertTraceHandle(value: string): void {
  if (!/^[a-f0-9]{32}$/.test(value)) throw new Error("INVALID_TRACE_HANDLE");
}

export function assertEvidenceScores(values: readonly number[]): void {
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error("INVALID_EVIDENCE_SCORE");
}
