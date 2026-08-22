import { describe, expect, it } from "vitest";
import { adminQueueMetrics, formatAdminQueueCount, type AdminJobQueue } from "./admin-job-queue";

describe("administrator job queue presentation", () => {
  it("formats capped aggregates without presenting them as exact counts", () => {
    expect(formatAdminQueueCount({ value: 8, capped: false })).toBe("8");
    expect(formatAdminQueueCount({ value: 100, capped: true })).toBe("100+");
  });

  it("renders only the fixed sanitized job-state aggregates", () => {
    const jobQueue: AdminJobQueue = {
      queued: { value: 3, capped: false },
      leased: { value: 2, capped: false },
      running: { value: 100, capped: true },
      retryable: { value: 1, capped: false },
      failed: { value: 0, capped: false },
    };

    expect(adminQueueMetrics(jobQueue)).toEqual([
      expect.objectContaining({ state: "queued", label: "Queued", value: "3" }),
      expect.objectContaining({ state: "leased", label: "Leased", value: "2" }),
      expect.objectContaining({ state: "running", label: "Running", value: "100+" }),
      expect.objectContaining({ state: "retryable", label: "Retryable", value: "1" }),
      expect.objectContaining({ state: "failed", label: "Failed", value: "0" }),
    ]);
  });
});
