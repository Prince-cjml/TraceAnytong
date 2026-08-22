import type { TraceCandidate } from "./demo-data";

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
};

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

export function mapCaseCandidates(candidates: readonly ControlPlaneCandidate[]): TraceCandidate[] {
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
