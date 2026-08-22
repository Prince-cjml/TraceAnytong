"use client";

import { Badge, Card } from "@traceanytong/ui";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export type BoundedCount = { value: number; capped: boolean };
export type AdminJobState = "queued" | "leased" | "running" | "retryable" | "failed";

export type AdminJobQueue = Record<AdminJobState, BoundedCount>;

export type AdminQueueSummary = {
  jobQueue: AdminJobQueue | null;
};

export type AdminQueueMetric = {
  state: AdminJobState;
  label: string;
  value: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  detail: string;
};

const STATE_PRESENTATION: Record<AdminJobState, Omit<AdminQueueMetric, "value">> = {
  queued: { state: "queued", label: "Queued", tone: "neutral", detail: "Awaiting a lease" },
  leased: { state: "leased", label: "Leased", tone: "info", detail: "Lease reserved" },
  running: { state: "running", label: "Running", tone: "success", detail: "In progress" },
  retryable: { state: "retryable", label: "Retryable", tone: "warning", detail: "Eligible for retry" },
  failed: { state: "failed", label: "Failed", tone: "danger", detail: "Terminal jobs" },
};

export function formatAdminQueueCount({ value, capped }: BoundedCount): string {
  return capped ? `${value}+` : String(value);
}

/** Maps the sanitized aggregate supplied by the control plane to display copy.
 * It deliberately accepts no job-level information. */
export function adminQueueMetrics(jobQueue: AdminJobQueue): AdminQueueMetric[] {
  return (Object.keys(STATE_PRESENTATION) as AdminJobState[]).map((state) => ({
    ...STATE_PRESENTATION[state],
    value: formatAdminQueueCount(jobQueue[state]),
  }));
}

/**
 * Compact administrator-only aggregate. Loading and non-administrator states
 * intentionally reveal no queue telemetry; authorization remains server-owned.
 */
export function AdminJobQueue() {
  const summary = useQuery((api as any).dashboard.getSummary, {}) as AdminQueueSummary | undefined;

  if (summary === undefined || summary.jobQueue === null) {
    return <div hidden data-admin-job-queue="unavailable" />;
  }

  const metrics = adminQueueMetrics(summary.jobQueue);
  return <Card className="queue" aria-label="Administrator job queue summary">
    <div className="card-head">
      <div>
        <p>Administrator queue</p>
        <strong>Sanitized job-state totals</strong>
      </div>
      <Badge tone="info">ADMIN ONLY</Badge>
    </div>
    <div
      aria-label="Job state totals"
      style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, marginTop: 18 }}
    >
      {metrics.map((metric) => <div key={metric.state} style={{ minWidth: 0 }}>
        <Badge tone={metric.tone}>{metric.label}</Badge>
        <b style={{ display: "block", fontSize: 21, letterSpacing: "-0.04em", margin: "8px 0 3px" }}>{metric.value}</b>
        <small className="muted" style={{ display: "block", marginTop: 0, lineHeight: 1.35 }}>{metric.detail}</small>
      </div>)}
    </div>
  </Card>;
}
