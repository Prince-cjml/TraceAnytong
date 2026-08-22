/**
 * Cross-service protocol contracts. Trace handles are opaque identifiers only;
 * human identity resolution is deliberately confined to the control plane.
 */
export const TRACE_PROTOCOL_VERSION = "0.1" as const;

export type TraceScope = "issuance" | "web_session";
export type Carrier = "image" | "screen" | "structure";

export interface TraceIdentity {
  traceHandle: string;
  scope: TraceScope;
  profileVersion: string;
  createdAt: number;
}

export interface CarrierBinding {
  traceHandle: string;
  carrier: Carrier;
  carrierVersion: string;
  /** A model-sized code, never a replacement for the 128-bit trace handle. */
  wmCode?: number;
  keyVersion: string;
}

/** Database IDs are intentionally represented as opaque strings at package boundaries. */
export interface ProvenanceBinding {
  documentId: string;
  versionId: string;
  issuanceId?: string;
  webSessionId?: string;
}

export interface VersionStamp {
  protocolVersion: string;
  profileVersion: string;
  carrierVersion: string;
  detectorVersion: string;
  fingerprintVersion: string;
  keyVersion: string;
  modelVersion?: string;
  workerVersion?: string;
}

/** A canonical 16-byte lowercase hexadecimal representation. */
export function isTraceHandle(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value);
}

/**
 * Validates an opaque trace handle at service boundaries. It cannot encode an
 * email or database ID because its representation is fixed to random bytes.
 */
export function assertTraceHandle(value: string): string {
  if (!isTraceHandle(value)) {
    throw new Error("traceHandle must be a 128-bit lowercase hexadecimal identifier");
  }
  return value;
}

export function createTraceIdentity(
  traceHandle: string,
  scope: TraceScope,
  profileVersion: string,
  createdAt: number,
): TraceIdentity {
  return { traceHandle: assertTraceHandle(traceHandle), scope, profileVersion, createdAt };
}

export type JobState = "queued" | "leased" | "running" | "retryable" | "succeeded" | "failed";

export const RETRY_DELAYS_MS = [0, 30_000, 120_000, 600_000] as const;

/** Attempts are one-based. Attempts after the defined policy use the final delay. */
export function retryDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("attempt must be a positive integer");
  }
  return RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
}

export function canTransitionJob(from: JobState, to: JobState): boolean {
  return (
    (from === "queued" && to === "leased") ||
    (from === "leased" && (to === "running" || to === "retryable")) ||
    (from === "running" && (to === "succeeded" || to === "retryable" || to === "failed")) ||
    (from === "retryable" && to === "queued")
  );
}

export type TraceDecision = "attributed" | "insufficient" | "no_match";

/** Attribution is permitted only with a measured lead over the second candidate. */
export function decideTrace(
  bestScore: number,
  secondScore: number | undefined,
  minimumScore: number,
  minimumMargin: number,
): TraceDecision {
  if (!Number.isFinite(bestScore) || bestScore < minimumScore) return "insufficient";
  const margin = secondScore === undefined ? bestScore : bestScore - secondScore;
  return margin >= minimumMargin ? "attributed" : "insufficient";
}
