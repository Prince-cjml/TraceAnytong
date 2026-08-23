export const MAX_TRACE_CANDIDATES = 100;
export const PERCEPTUAL_FINGERPRINT_VERSION = "perceptual-v1";

export type IssuanceFingerprintProjection = {
  fingerprintVersion: typeof PERCEPTUAL_FINGERPRINT_VERSION;
  sha256: string;
  mimeType: string;
  dHash?: string;
  width?: number;
  height?: number;
};

export type TraceCandidateSnapshotBinding = {
  traceHandle: string;
  scope: "issuance" | "web_session";
  createdAt: number;
  issuanceId?: string;
  webSessionId?: string;
  wmCode?: number;
  outputSha256?: string;
  outputFingerprint?: IssuanceFingerprintProjection;
};

export type SubmittedCandidateBinding = {
  traceHandle: string;
  issuanceId?: string;
  webSessionId?: string;
};

const TRACE_HANDLE = /^[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DHASH = /^[a-f0-9]{16}$/;
const SUPPORTED_FINGERPRINT_MIMES = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const SNAPSHOT_FIELDS = new Set([
  "traceHandle", "scope", "createdAt", "issuanceId", "webSessionId", "wmCode", "outputSha256", "outputFingerprint",
]);
const FINGERPRINT_FIELDS = new Set(["fingerprintVersion", "sha256", "mimeType", "dHash", "width", "height"]);

/**
 * Project only the stable, anonymous portion of a worker-produced perceptual
 * fingerprint. This accepts the known worker version rather than copying an
 * arbitrary result object, which may contain bytes, warnings, or future
 * non-contract fields.
 */
export function projectIssuanceFingerprint(value: unknown): IssuanceFingerprintProjection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const fingerprint = value as Record<string, unknown>;
  if (fingerprint.fingerprintVersion !== PERCEPTUAL_FINGERPRINT_VERSION
    || typeof fingerprint.sha256 !== "string" || !SHA256.test(fingerprint.sha256)
    || typeof fingerprint.mimeType !== "string" || !SUPPORTED_FINGERPRINT_MIMES.has(fingerprint.mimeType)) {
    return undefined;
  }
  const hasDHash = fingerprint.dHash !== undefined;
  const hasWidth = fingerprint.width !== undefined;
  const hasHeight = fingerprint.height !== undefined;
  if (hasDHash && (typeof fingerprint.dHash !== "string" || !DHASH.test(fingerprint.dHash))) return undefined;
  if (hasWidth !== hasHeight
    || (hasWidth && (!Number.isSafeInteger(fingerprint.width) || (fingerprint.width as number) < 1
      || !Number.isSafeInteger(fingerprint.height) || (fingerprint.height as number) < 1))) {
    return undefined;
  }
  return {
    fingerprintVersion: PERCEPTUAL_FINGERPRINT_VERSION,
    sha256: fingerprint.sha256,
    mimeType: fingerprint.mimeType,
    ...(hasDHash ? { dHash: fingerprint.dHash as string } : {}),
    ...(hasWidth ? { width: fingerprint.width as number, height: fingerprint.height as number } : {}),
  };
}

/** Validate the persisted, anonymous trace-job binding set. */
export function assertTraceCandidateSnapshot(snapshot: readonly TraceCandidateSnapshotBinding[]): void {
  if (snapshot.length > MAX_TRACE_CANDIDATES) throw new Error("TRACE_CANDIDATE_SNAPSHOT_LIMIT_EXCEEDED");
  for (const candidate of snapshot) {
    if (Object.keys(candidate).some((field) => !SNAPSHOT_FIELDS.has(field))) {
      throw new Error("INVALID_TRACE_CANDIDATE_SNAPSHOT");
    }
    if (!TRACE_HANDLE.test(candidate.traceHandle) || !Number.isSafeInteger(candidate.createdAt) || candidate.createdAt < 0) {
      throw new Error("INVALID_TRACE_CANDIDATE_SNAPSHOT");
    }
    const hasIssuance = typeof candidate.issuanceId === "string";
    const hasWebSession = typeof candidate.webSessionId === "string";
    if (hasIssuance === hasWebSession) throw new Error("INVALID_TRACE_CANDIDATE_SNAPSHOT");
    if (candidate.scope === "issuance") {
      if (!hasIssuance || hasWebSession || !SHA256.test(candidate.outputSha256 ?? "")) {
        throw new Error("INVALID_TRACE_CANDIDATE_SNAPSHOT");
      }
      if (candidate.wmCode !== undefined && (!Number.isInteger(candidate.wmCode) || candidate.wmCode < 0 || candidate.wmCode > 0xffffffff)) {
        throw new Error("INVALID_TRACE_CANDIDATE_SNAPSHOT");
      }
      if (candidate.outputFingerprint !== undefined) {
        if (!candidate.outputFingerprint || typeof candidate.outputFingerprint !== "object"
          || Array.isArray(candidate.outputFingerprint)
          || Object.keys(candidate.outputFingerprint).some((field) => !FINGERPRINT_FIELDS.has(field))
          || !projectIssuanceFingerprint(candidate.outputFingerprint)
          || candidate.outputFingerprint.sha256 !== candidate.outputSha256) {
          throw new Error("INVALID_TRACE_CANDIDATE_SNAPSHOT");
        }
      }
    } else if (candidate.scope === "web_session") {
      if (!hasWebSession || hasIssuance || candidate.wmCode !== undefined || candidate.outputSha256 !== undefined || candidate.outputFingerprint !== undefined) {
        throw new Error("INVALID_TRACE_CANDIDATE_SNAPSHOT");
      }
    } else {
      throw new Error("INVALID_TRACE_CANDIDATE_SNAPSHOT");
    }
  }
}

/** Return a fresh worker payload projected solely from the immutable snapshot. */
export function workerCandidatesFromSnapshot(
  snapshot: readonly TraceCandidateSnapshotBinding[],
): TraceCandidateSnapshotBinding[] {
  assertTraceCandidateSnapshot(snapshot);
  return snapshot.map((candidate) => candidate.scope === "issuance"
    ? {
      traceHandle: candidate.traceHandle, scope: "issuance", createdAt: candidate.createdAt,
      issuanceId: candidate.issuanceId,
      ...(candidate.wmCode === undefined ? {} : { wmCode: candidate.wmCode }),
      outputSha256: candidate.outputSha256,
      ...(candidate.outputFingerprint === undefined ? {} : {
        outputFingerprint: { ...candidate.outputFingerprint },
      }),
    }
    : {
      traceHandle: candidate.traceHandle, scope: "web_session", createdAt: candidate.createdAt,
      webSessionId: candidate.webSessionId,
    });
}

/** Require an exact ID, trace handle, and provenance-kind match to the snapshot. */
export function assertCandidateInTraceSnapshot(
  snapshot: readonly TraceCandidateSnapshotBinding[],
  submitted: SubmittedCandidateBinding,
): void {
  assertTraceCandidateSnapshot(snapshot);
  const hasIssuance = typeof submitted.issuanceId === "string";
  const hasWebSession = typeof submitted.webSessionId === "string";
  const matches = hasIssuance !== hasWebSession && snapshot.some((candidate) => (
    candidate.traceHandle === submitted.traceHandle
    && (hasIssuance
      ? candidate.scope === "issuance" && candidate.issuanceId === submitted.issuanceId
      : candidate.scope === "web_session" && candidate.webSessionId === submitted.webSessionId)
  ));
  if (!matches) throw new Error("TRACE_CANDIDATE_SNAPSHOT_MISMATCH");
}
