import { describe, expect, it } from "vitest";
import { dataState, mapCaseCandidates, mapDocuments } from "./control-plane";

describe("control-plane UI adapters", () => {
  it("keeps fixtures as an explicit disabled-auth fallback", () => {
    expect(dataState({ enabled: false, loading: false, fallback: ["fixture"] })).toEqual({ kind: "ready", source: "demo", data: ["fixture"] });
  });

  it("maps loading, failure, and empty live query states without presenting fixture data", () => {
    expect(dataState({ enabled: true, loading: true, fallback: ["fixture"] }).kind).toBe("loading");
    expect(dataState({ enabled: true, loading: false, error: "FORBIDDEN", fallback: ["fixture"] })).toMatchObject({ kind: "error", source: "live" });
    expect(dataState({ enabled: true, loading: false, data: [], fallback: ["fixture"] })).toEqual({ kind: "empty", source: "live" });
  });

  it("does not convert an insufficient control-plane decision into attribution", () => {
    const [candidate] = mapCaseCandidates([{ rank: 1, traceHandle: "opaque", watermarkScore: .3, watermarkMargin: .01, fingerprintScore: .8, geometricScore: .7, structureScore: .2, timelineScore: .1, decision: "insufficient", explanation: "margin below profile threshold", rawEvidence: {} }]);
    expect(candidate.decision).toBe("INSUFFICIENT");
    expect(candidate.warning).toContain("margin");
  });

  it("projects allowlisted screen evidence while dropping identities, URLs, and arbitrary worker payloads", () => {
    const [candidate] = mapCaseCandidates([{ rank: 1, traceHandle: "opaque", watermarkScore: .8, watermarkMargin: .2, fingerprintScore: 0, geometricScore: 0, structureScore: 0, timelineScore: 1, decision: "insufficient", explanation: "ambiguous", rawEvidence: {
      topScreenCorrelation: { score: .8, raw: { phase: { x: 4, y: 7 }, peak: .91, secondPeak: .61, margin: .3, tileSize: 64, profileSecret: "do-not-show" }, warnings: ["correlation peak is ambiguous", "recipient alice@example.com"] },
      candidateScores: [{ traceHandle: "opaque", score: .8 }, { traceHandle: "other", score: .5 }],
      recipient: "alice@example.com", sourceUrl: "https://private.example/evidence", arbitrary: { token: "do-not-show" },
    } }]);
    expect(candidate.evidence).toEqual({ kind: "screen", facts: [
      { label: "Correlation score", value: "0.8000" }, { label: "Peak", value: "0.9100" }, { label: "Second peak", value: "0.6100" }, { label: "Correlation margin", value: "0.3000" }, { label: "Peak phase", value: "4, 7" }, { label: "Tile size", value: "64" }, { label: "Candidates scored", value: "2" },
    ], warnings: ["correlation peak is ambiguous"] });
    expect(JSON.stringify(candidate.evidence)).not.toMatch(/alice|opaque|private|secret|token/i);
  });

  it("retains rank-specific screen correlation evidence without exposing the score vector identities", () => {
    const [candidate] = mapCaseCandidates([{ rank: 2, traceHandle: "opaque", watermarkScore: .5, watermarkMargin: 0, fingerprintScore: 0, geometricScore: 0, structureScore: 0, timelineScore: 1, decision: "insufficient", explanation: "runner-up", rawEvidence: {
      screenCorrelation: { score: .5, raw: { phase: { x: 1, y: 2 }, peak: .52, secondPeak: .4, margin: .12, tileSize: 64 }, warnings: [] },
      candidateScores: [{ rank: 1, traceHandle: "top", webSessionId: "session:top", score: .8 }, { rank: 2, traceHandle: "opaque", webSessionId: "session:runner-up", score: .5 }],
    } }]);
    expect(candidate.evidence).toMatchObject({ kind: "screen", warnings: [] });
    expect(candidate.evidence?.facts).toContainEqual({ label: "Correlation score", value: "0.5000" });
    expect(candidate.evidence?.facts).toContainEqual({ label: "Candidates scored", value: "2" });
    expect(JSON.stringify(candidate.evidence)).not.toMatch(/session|opaque|top/i);
  });

  it("retains control-plane document metadata without manufacturing recipient data", () => {
    const [document] = mapDocuments([{ title: "Strategy", classification: "Restricted", updatedAt: 0, currentVersionId: "version" }]);
    expect(document).toMatchObject({ title: "Strategy", classification: "Restricted", issuances: 0, status: "Protected" });
  });
});
