/**
 * Candidate provenance is resolved by the server. A worker cannot use a
 * valid binding from a different profile to populate a trace job.
 */
export function assertCandidateProfileMatchesTraceJob(
  traceJobProfileId: string,
  provenanceProfileId: string,
): void {
  if (traceJobProfileId !== provenanceProfileId) {
    throw new Error("CANDIDATE_PROFILE_MISMATCH");
  }
}
