import { MAX_TRACE_CANDIDATES } from "./traceCandidateSnapshotRules.ts";

export type TraceCarrier = "image" | "screen" | "structure";
export type RequestedTraceDecision = "attributed" | "insufficient" | "no_match";

/**
 * A trace rank is server-bounded independently of a worker's candidate list.
 * This protects the persisted evidence surface from unbounded or malformed
 * submissions even when a worker has a valid lease.
 */
export function assertCandidateRank(rank: number): void {
  if (!Number.isInteger(rank) || rank < 1 || rank > MAX_TRACE_CANDIDATES) {
    throw new Error("INVALID_CANDIDATE_RANK");
  }
}

/**
 * Screen detection is a two-candidate comparison: the top result may ask for
 * server threshold resolution, while the runner-up is retained only as raw,
 * insufficient evidence. Other carriers retain their existing decision path.
 */
export function assertCandidateRankForCarrier(
  rank: number,
  carrier: TraceCarrier,
  requestedDecision: RequestedTraceDecision,
): void {
  assertCandidateRank(rank);
  if (carrier !== "screen") return;
  if (rank > 2) throw new Error("SCREEN_CANDIDATE_RANK_LIMIT");
  if (rank !== 1 && requestedDecision === "attributed") {
    throw new Error("SCREEN_RUNNER_UP_ATTRIBUTION_FORBIDDEN");
  }
}
