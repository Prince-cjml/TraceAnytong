import { describe, expect, it } from "vitest";
import { formatTraceCaseTime, projectTraceCase, traceCaseStatePresentation, type TraceCaseListItem } from "./trace-case-queue";

describe("trace case queue presentation", () => {
  it("formats case timestamps as explicit UTC values and withholds missing completion times", () => {
    expect(formatTraceCaseTime(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe("2026-01-02 03:04:05 UTC");
    expect(formatTraceCaseTime(undefined)).toBe("Not completed");
    expect(formatTraceCaseTime(Number.NaN)).toBe("Not completed");
  });

  it("uses fixed, readable labels for every server-defined case state", () => {
    expect(traceCaseStatePresentation("queued")).toEqual({ stateLabel: "Queued", stateTone: "neutral" });
    expect(traceCaseStatePresentation("processing")).toEqual({ stateLabel: "Analyzing", stateTone: "info" });
    expect(traceCaseStatePresentation("complete")).toEqual({ stateLabel: "Complete", stateTone: "success" });
    expect(traceCaseStatePresentation("failed")).toEqual({ stateLabel: "Needs attention", stateTone: "danger" });
  });

  it("projects only the approved queue fields and never carries evidence or candidate data", () => {
    const source: TraceCaseListItem & { evidenceSha256: string; candidate: string; workerError: string } = {
      _id: "traceCases:opaque-case-id",
      state: "complete",
      evidenceMime: "image/png",
      protocolVersion: "protocol/0.1",
      detectorVersion: "detector/2.4.0",
      fingerprintVersion: "fingerprint/1.3.0",
      workerVersion: "worker/0.4.1",
      createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
      completedAt: Date.UTC(2026, 0, 2, 3, 5, 5),
      evidenceSha256: "e".repeat(64),
      candidate: "forbidden identity",
      workerError: "forbidden worker error",
    };

    expect(projectTraceCase(source)).toEqual({
      caseId: "traceCases:opaque-case-id",
      state: "complete",
      stateLabel: "Complete",
      stateTone: "success",
      evidenceMime: "image/png",
      createdAt: "2026-01-02 03:04:05 UTC",
      completedAt: "2026-01-02 03:05:05 UTC",
      versions: [
        { label: "Protocol", value: "protocol/0.1" },
        { label: "Detector", value: "detector/2.4.0" },
        { label: "Fingerprint", value: "fingerprint/1.3.0" },
        { label: "Worker", value: "worker/0.4.1" },
      ],
    });
  });
});
