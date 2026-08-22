"use client";

import { useQuery } from "convex/react";
import { Badge, Card, Kpi } from "@traceanytong/ui";
import { api } from "../../../convex/_generated/api";

export type BoundedCount = { value: number; capped: boolean };

export type DashboardSummary = {
  organizationName?: string;
  memberDisplayName?: string;
  role: string;
  sourceDocuments: BoundedCount;
  activeOwnSessions: BoundedCount;
  traceCases: null | {
    total: BoundedCount;
    open: BoundedCount;
  };
};

type SummaryMetric = {
  label: string;
  value: string;
  change: string;
  tone: "blue" | "violet" | "green" | "amber";
};

export function boundedCountLabel({ value, capped }: BoundedCount) {
  return capped ? `${value}+` : String(value);
}

export function summaryRoleLabel(role: string) {
  return role.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function liveSummaryMetrics(summary: DashboardSummary) {
  const metrics: SummaryMetric[] = [
    { label: "Source documents", value: boundedCountLabel(summary.sourceDocuments), change: "Immutable sources", tone: "blue" as const },
    { label: "My active sessions", value: boundedCountLabel(summary.activeOwnSessions), change: "Authorized sessions", tone: "green" as const },
  ];

  if (summary.traceCases) {
    metrics.push(
      { label: "Trace cases", value: boundedCountLabel(summary.traceCases.total), change: "Authorized case registry", tone: "violet" as const },
      { label: "Open trace cases", value: boundedCountLabel(summary.traceCases.open), change: "Awaiting completion or review", tone: "amber" as const },
    );
  }

  return metrics;
}

export function LiveSummary() {
  const summary = useQuery((api as any).dashboard.getSummary, {}) as DashboardSummary | undefined;

  if (summary === undefined) {
    return <Card className="live-document-note" aria-busy="true" aria-live="polite">
      <Badge tone="info">LIVE SUMMARY</Badge>
      <h2>Loading authorized workspace summary…</h2>
      <p>Counts appear only after the control plane confirms this member session.</p>
    </Card>;
  }

  const metrics = liveSummaryMetrics(summary);
  return <section aria-label="Authorized workspace summary">
    <div className="card-head" style={{ marginBottom: 14 }}>
      <div>
        <p>Live control-plane summary</p>
        <strong>Workspace overview</strong>
      </div>
      <Badge tone="info">{summaryRoleLabel(summary.role)}</Badge>
    </div>
    <div className="kpis">
      {metrics.map((metric) => <Kpi key={metric.label} {...metric} />)}
    </div>
  </section>;
}
