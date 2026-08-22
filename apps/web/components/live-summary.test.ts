import { describe, expect, it } from "vitest";
import { boundedCountLabel, liveSummaryMetrics, summaryRoleLabel, type DashboardSummary } from "./live-summary";

describe("live dashboard summary", () => {
  it("formats bounded counts without inventing a precise value above the server cap", () => {
    expect(boundedCountLabel({ value: 12, capped: false })).toBe("12");
    expect(boundedCountLabel({ value: 100, capped: true })).toBe("100+");
  });

  it("keeps investigator-only case metrics absent when the endpoint withholds them", () => {
    const viewer: DashboardSummary = {
      role: "viewer",
      sourceDocuments: { value: 3, capped: false },
      activeOwnSessions: { value: 1, capped: false },
      traceCases: null,
    };

    expect(liveSummaryMetrics(viewer).map((metric) => metric.label)).toEqual([
      "Source documents",
      "My active sessions",
    ]);
  });

  it("renders authorized trace totals and a readable server-issued role label", () => {
    const investigator: DashboardSummary = {
      role: "lead_investigator",
      sourceDocuments: { value: 100, capped: true },
      activeOwnSessions: { value: 0, capped: false },
      traceCases: { total: { value: 100, capped: true }, open: { value: 7, capped: false } },
    };

    expect(summaryRoleLabel(investigator.role)).toBe("Lead Investigator");
    expect(liveSummaryMetrics(investigator)).toMatchObject([
      { label: "Source documents", value: "100+" },
      { label: "My active sessions", value: "0" },
      { label: "Trace cases", value: "100+" },
      { label: "Open trace cases", value: "7" },
    ]);
  });
});
