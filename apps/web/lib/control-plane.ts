import type { TraceCandidate } from "./demo-data";

export type SafeEvidenceDetail = {
  kind: "screen" | "structure" | "image";
  facts: readonly { label: string; value: string }[];
  warnings: readonly string[];
};

export type LiveTraceCandidate = TraceCandidate & { evidence?: SafeEvidenceDetail };

export type DataState<T> =
  | { kind: "loading"; source: "live" }
  | { kind: "error"; source: "live"; message: string }
  | { kind: "empty"; source: "live" }
  | { kind: "ready"; source: "live" | "demo"; data: T };

export type WorkspaceDocument = {
  title: string;
  type: string;
  version: string;
  classification: string;
  issuances: number;
  activity: string;
  status: string;
  hue: string;
};

type ControlPlaneDocument = {
  title: string;
  classification: string;
  updatedAt: number;
  currentVersionId?: string;
};

type ControlPlaneCandidate = {
  rank: number;
  traceHandle: string;
  watermarkScore: number;
  watermarkMargin: number;
  fingerprintScore: number;
  geometricScore: number;
  structureScore: number;
  timelineScore: number;
  decision: "attributed" | "insufficient" | "no_match";
  explanation: string;
  rawEvidence: unknown;
};

const safeWarnings = new Set([
  "correlation peak is ambiguous",
  "PDF is encrypted; protected content was not inspected",
  "no protocol-shaped native TraceAnytong provenance marker was found",
  "native marker exists without a measured carrier-shaped placement",
  "carrier-shaped native placement is non-identifying without candidate-matched visual evidence",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberFact(label: string, value: unknown): { label: string; value: string } | null {
  const numeric = finite(value);
  return numeric === null ? null : { label, value: numeric.toFixed(4) };
}

function boundedCount(label: string, value: unknown, maximum = 100): { label: string; value: string } | null {
  const numeric = finite(value);
  return numeric === null || !Number.isInteger(numeric) || numeric < 0 || numeric > maximum ? null : { label, value: String(numeric) };
}

function warnings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((warning): warning is string => typeof warning === "string" && safeWarnings.has(warning)).slice(0, 5) : [];
}

/** Deliberately projects only known forensic fields; identifiers and arbitrary worker payloads stay server-side. */
export function projectEvidence(rawEvidence: unknown): SafeEvidenceDetail | undefined {
  const raw = record(rawEvidence);
  if (!raw) return undefined;
  const screen = record(raw.topScreenCorrelation) ?? record(raw.screenCorrelation);
  if (screen) {
    const correlation = record(screen.raw);
    const phase = record(correlation?.phase);
    const candidateScores = Array.isArray(raw.candidateScores) ? raw.candidateScores.length : null;
    const facts = [
      numberFact("Correlation score", screen.score),
      numberFact("Peak", correlation?.peak),
      numberFact("Second peak", correlation?.secondPeak),
      numberFact("Correlation margin", correlation?.margin),
      phase && finite(phase.x) !== null && finite(phase.y) !== null ? { label: "Peak phase", value: `${finite(phase.x)}, ${finite(phase.y)}` } : null,
      boundedCount("Tile size", correlation?.tileSize, 512),
      candidateScores === null ? null : boundedCount("Candidates scored", candidateScores),
    ].filter((fact): fact is { label: string; value: string } => fact !== null);
    return { kind: "screen", facts, warnings: warnings(screen.warnings) };
  }
  const nativeStructure = record(raw.nativeStructure);
  const structure = record(nativeStructure?.raw);
  if (nativeStructure && structure) {
    const components = record(structure.scoreComponents);
    const format = ["pdf", "docx", "pptx"].includes(String(structure.format)) ? String(structure.format).toUpperCase() : null;
    const facts = [
      format ? { label: "Native format", value: format } : null,
      numberFact("Structure support", nativeStructure.score),
      numberFact("Native marker", components?.nativeMarker),
      numberFact("Carrier placement", components?.carrierShapedPlacement),
      numberFact("Candidate marker match", components?.candidateMarkerMatch),
    ].filter((fact): fact is { label: string; value: string } => fact !== null);
    return { kind: "structure", facts, warnings: warnings(nativeStructure.warnings) };
  }
  const image = record(raw.imageCarrier);
  if (image) return { kind: "image", facts: [numberFact("Image carrier score", image.score)].filter((fact): fact is { label: string; value: string } => fact !== null), warnings: warnings(image.warnings) };
  return undefined;
}

export function mapDocuments(documents: readonly ControlPlaneDocument[]): WorkspaceDocument[] {
  return documents.map((document, index) => ({
    title: document.title,
    type: "SOURCE",
    version: document.currentVersionId ? "Current" : "No source version",
    classification: document.classification,
    issuances: 0,
    activity: new Date(document.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    status: document.currentVersionId ? "Protected" : "Ready",
    hue: (["violet", "blue", "amber", "green"] as const)[index % 4],
  }));
}

export function mapCaseCandidates(candidates: readonly ControlPlaneCandidate[]): LiveTraceCandidate[] {
  return candidates.map((candidate) => ({
    rank: candidate.rank,
    traceHandle: candidate.traceHandle,
    issuance: "Authenticated candidate",
    issuedAt: "Recorded by control plane",
    watermarkScore: candidate.watermarkScore,
    watermarkMargin: candidate.watermarkMargin,
    fingerprintScore: candidate.fingerprintScore,
    geometricScore: candidate.geometricScore,
    structureScore: candidate.structureScore,
    timelineScore: candidate.timelineScore,
    decision: candidate.decision === "attributed" ? "HIGH" : "INSUFFICIENT",
    warning: candidate.decision === "attributed" ? undefined : candidate.explanation,
    evidence: projectEvidence(candidate.rawEvidence),
  }));
}

export function dataState<T>(input: {
  enabled: boolean;
  loading: boolean;
  error?: string;
  data?: readonly T[];
  fallback: readonly T[];
}): DataState<readonly T[]> {
  if (!input.enabled) return { kind: "ready", source: "demo", data: input.fallback };
  if (input.loading) return { kind: "loading", source: "live" };
  if (input.error) return { kind: "error", source: "live", message: input.error };
  if (!input.data || input.data.length === 0) return { kind: "empty", source: "live" };
  return { kind: "ready", source: "live", data: input.data };
}
