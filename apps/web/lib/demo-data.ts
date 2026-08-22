export type Decision = "HIGH" | "MEDIUM" | "INSUFFICIENT";

export type TraceCandidate = {
  rank: number;
  traceHandle: string;
  issuance: string;
  issuedAt: string;
  watermarkScore: number | null;
  watermarkMargin: number | null;
  fingerprintScore: number | null;
  geometricScore: number | null;
  structureScore: number | null;
  timelineScore: number | null;
  decision: Decision;
  warning?: string;
};

export const documents = [
  { title: "FY27 Growth Strategy", type: "PDF", version: "v12", classification: "Restricted", issuances: 38, activity: "8 min ago", status: "Protected", hue: "violet" },
  { title: "Project Atlas Architecture", type: "DOCX", version: "v7", classification: "Confidential", issuances: 24, activity: "42 min ago", status: "Protected", hue: "blue" },
  { title: "Board Readout — Q2", type: "PPTX", version: "v3", classification: "Restricted", issuances: 12, activity: "Yesterday", status: "Protected", hue: "amber" },
  { title: "Pricing model export", type: "PNG", version: "v4", classification: "Internal", issuances: 9, activity: "Yesterday", status: "Ready", hue: "green" },
];

export const traceCandidates: TraceCandidate[] = [
  { rank: 1, traceHandle: "trc_7f2a…d914", issuance: "ISS-2048 · anonymous recipient", issuedAt: "Today, 09:14", watermarkScore: 0.934, watermarkMargin: 0.218, fingerprintScore: 0.981, geometricScore: 0.92, structureScore: 0.77, timelineScore: 0.89, decision: "HIGH" },
  { rank: 2, traceHandle: "trc_32b1…c6e0", issuance: "ISS-2034 · anonymous recipient", issuedAt: "Today, 08:53", watermarkScore: 0.716, watermarkMargin: null, fingerprintScore: 0.981, geometricScore: 0.92, structureScore: 0.77, timelineScore: 0.66, decision: "INSUFFICIENT", warning: "Watermark separation below profile threshold." },
  { rank: 3, traceHandle: "trc_a8e6…e74f", issuance: "ISS-1991 · anonymous recipient", issuedAt: "Yesterday, 17:02", watermarkScore: 0.522, watermarkMargin: null, fingerprintScore: 0.981, geometricScore: 0.92, structureScore: 0.77, timelineScore: 0.36, decision: "INSUFFICIENT" },
];

export const insufficientCandidate: TraceCandidate = {
  rank: 1, traceHandle: "—", issuance: "No attributable issuance", issuedAt: "—", watermarkScore: 0.42, watermarkMargin: 0.025, fingerprintScore: 0.89, geometricScore: 0.71, structureScore: null, timelineScore: 0.48, decision: "INSUFFICIENT", warning: "Candidate margin is below the document-screen profile threshold (0.12)."
};

export const processingSteps = ["Evidence preserved", "Content candidate found", "Geometry recovered", "Watermark candidates evaluated", "Timeline correlated"];

export const workers = [
  { id: "wk-cpu-07", class: "CPU", state: "Healthy", jobs: 14, lease: "09:32:18", version: "worker/0.1.0" },
  { id: "wk-hybrid-02", class: "HYBRID", state: "Healthy", jobs: 8, lease: "09:32:11", version: "worker/0.1.0" },
  { id: "wk-gpu-01", class: "GPU", state: "Busy", jobs: 23, lease: "09:32:03", version: "worker/0.1.0" },
];

export const benchmarkRows = [
  ["PDF screenshot · full page", "98.7%", "0", "0.31", "Pass"],
  ["JPEG 60 + resize 0.75×", "96.2%", "0", "0.24", "Pass"],
  ["Crop · 35% retained", "91.4%", "0", "0.14", "Pass"],
  ["Unwatermarked negative corpus", "—", "0", "—", "Pass"],
];

export function score(value: number | null) { return value === null ? "Not available" : `${Math.round(value * 100)}%`; }
export function decisionTone(decision: Decision) { return decision === "HIGH" ? "success" : decision === "MEDIUM" ? "info" : "warning"; }
export function shouldAttribute(candidate: TraceCandidate) {
  return candidate.decision !== "INSUFFICIENT" && (candidate.watermarkMargin ?? 0) >= 0.12 && (candidate.fingerprintScore ?? 0) >= 0.8;
}
