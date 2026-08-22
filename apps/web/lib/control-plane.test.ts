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
    const [candidate] = mapCaseCandidates([{ rank: 1, traceHandle: "opaque", watermarkScore: .3, watermarkMargin: .01, fingerprintScore: .8, geometricScore: .7, structureScore: .2, timelineScore: .1, decision: "insufficient", explanation: "margin below profile threshold" }]);
    expect(candidate.decision).toBe("INSUFFICIENT");
    expect(candidate.warning).toContain("margin");
  });

  it("retains control-plane document metadata without manufacturing recipient data", () => {
    const [document] = mapDocuments([{ title: "Strategy", classification: "Restricted", updatedAt: 0, currentVersionId: "version" }]);
    expect(document).toMatchObject({ title: "Strategy", classification: "Restricted", issuances: 0, status: "Protected" });
  });
});
