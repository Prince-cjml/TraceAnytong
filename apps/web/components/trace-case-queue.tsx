"use client";

import { Component, type ReactNode, useEffect, useState } from "react";
import { Badge, Card } from "@traceanytong/ui";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

const PAGE_SIZE = 25;

export type TraceCaseState = "queued" | "processing" | "complete" | "failed";

export type TraceCaseListItem = {
  _id: string;
  state: TraceCaseState;
  evidenceMime: string;
  protocolVersion: string;
  detectorVersion: string;
  fingerprintVersion: string;
  workerVersion?: string;
  createdAt: number;
  completedAt?: number;
};

export type TraceCasePage = {
  cases: TraceCaseListItem[];
  continueCursor: string;
  isDone: boolean;
};

export type TraceCaseQueueItem = {
  caseId: string;
  state: TraceCaseState;
  stateLabel: string;
  stateTone: "neutral" | "info" | "success" | "danger";
  evidenceMime: string;
  createdAt: string;
  completedAt: string;
  versions: Array<{ label: string; value: string }>;
};

export type TraceCaseQueueProps = {
  selectedCaseId?: string;
  onSelectCase: (caseId: string) => void;
  className?: string;
};

const STATE_PRESENTATION: Record<TraceCaseState, Pick<TraceCaseQueueItem, "stateLabel" | "stateTone">> = {
  queued: { stateLabel: "Queued", stateTone: "neutral" },
  processing: { stateLabel: "Analyzing", stateTone: "info" },
  complete: { stateLabel: "Complete", stateTone: "success" },
  failed: { stateLabel: "Needs attention", stateTone: "danger" },
};

/** Formats server timestamps without claiming a timezone inferred from the viewer. */
export function formatTraceCaseTime(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "Not completed";
  return new Date(timestamp).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function traceCaseStatePresentation(state: TraceCaseState) {
  return STATE_PRESENTATION[state];
}

/**
 * Defense-in-depth display projection. Evidence hashes, storage references,
 * suspected documents, candidates, trace handles, and worker output are not
 * part of this type and therefore cannot be rendered by this component.
 */
export function projectTraceCase(item: TraceCaseListItem): TraceCaseQueueItem {
  const presentation = traceCaseStatePresentation(item.state);
  const versions = [
    { label: "Protocol", value: item.protocolVersion },
    { label: "Detector", value: item.detectorVersion },
    { label: "Fingerprint", value: item.fingerprintVersion },
    ...(item.workerVersion ? [{ label: "Worker", value: item.workerVersion }] : []),
  ];

  return {
    caseId: item._id,
    state: item.state,
    ...presentation,
    evidenceMime: item.evidenceMime,
    createdAt: formatTraceCaseTime(item.createdAt),
    completedAt: formatTraceCaseTime(item.completedAt),
    versions,
  };
}

type ErrorBoundaryProps = { children: ReactNode; onRetry: () => void };

class TraceCaseQueueErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <Card className="live-document-note" role="alert">
        <Badge tone="danger">TRACE CASES UNAVAILABLE</Badge>
        <h2>The authorized case queue could not be loaded.</h2>
        <p>No case details are shown until the control plane accepts a fresh request.</p>
        <button className="secondary" onClick={this.props.onRetry}>Try again</button>
      </Card>;
    }

    return this.props.children;
  }
}

/**
 * Investigator/admin-only case index. It deliberately has no fixture branch:
 * it either renders records returned by the member-authorized endpoint or a
 * clear unavailable, loading, or empty state.
 */
export function TraceCaseQueue(props: TraceCaseQueueProps) {
  const [retryKey, setRetryKey] = useState(0);
  return <TraceCaseQueueErrorBoundary key={retryKey} onRetry={() => setRetryKey((value) => value + 1)}>
    <TraceCaseQueueContents {...props} />
  </TraceCaseQueueErrorBoundary>;
}

function TraceCaseQueueContents({ selectedCaseId, onSelectCase, className }: TraceCaseQueueProps) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [items, setItems] = useState<TraceCaseQueueItem[]>([]);
  const page = useQuery((api as any).traceCases.list, { cursor, limit: PAGE_SIZE }) as TraceCasePage | undefined;

  useEffect(() => {
    if (!page) return;
    const incoming = page.cases.map(projectTraceCase);
    setItems((current) => {
      if (!cursor) return incoming;
      const byId = new Map(current.map((item) => [item.caseId, item]));
      for (const item of incoming) byId.set(item.caseId, item);
      return Array.from(byId.values());
    });
  }, [cursor, page]);

  if (page === undefined && items.length === 0) {
    return <Card className={className ?? "live-document-note"} aria-busy="true" aria-live="polite">
      <Badge tone="info">AUTHORIZED CASE QUEUE</Badge>
      <h2>Loading trace cases…</h2>
      <p>Case records appear only after the control plane confirms investigator access.</p>
    </Card>;
  }

  // The first page is safe to render immediately; the effect below retains it
  // before a later cursor page arrives. This avoids a misleading empty flash.
  const visibleItems = items.length > 0 ? items : (page?.cases.map(projectTraceCase) ?? []);

  if (page && visibleItems.length === 0) {
    return <Card className={className ?? "live-document-note"} aria-live="polite">
      <Badge tone="info">AUTHORIZED CASE QUEUE</Badge>
      <h2>No trace cases yet</h2>
      <p>Preserved evidence submitted by an investigator will appear here after the control plane creates its case record.</p>
    </Card>;
  }

  const loadingMore = page === undefined;
  const canLoadMore = page !== undefined && !page.isDone;
  return <section className={className} aria-label="Authorized trace case queue">
    <div className="card-head" style={{ marginBottom: 14 }}>
      <div>
        <p>Authorized trace case queue</p>
        <strong>Evidence analysis status</strong>
      </div>
      <Badge tone="info">INVESTIGATOR ACCESS</Badge>
    </div>
    <div style={{ display: "grid", gap: 10 }}>
      {visibleItems.map((item) => <TraceCaseRow key={item.caseId} item={item} selected={item.caseId === selectedCaseId} onSelect={onSelectCase} />)}
    </div>
    {(canLoadMore || loadingMore) && <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
      <button
        className="secondary"
        disabled={loadingMore}
        aria-busy={loadingMore || undefined}
        onClick={() => page && setCursor(page.continueCursor)}
      >
        {loadingMore ? "Loading more cases…" : "Load more cases"}
      </button>
    </div>}
  </section>;
}

function TraceCaseRow({ item, selected, onSelect }: { item: TraceCaseQueueItem; selected: boolean; onSelect: (caseId: string) => void }) {
  return <Card className="trace-case-queue-row" style={{ padding: 0, overflow: "hidden" }}>
    <button
      type="button"
      onClick={() => onSelect(item.caseId)}
      aria-pressed={selected}
      style={{ appearance: "none", background: "transparent", border: 0, color: "inherit", cursor: "pointer", display: "block", font: "inherit", padding: 18, textAlign: "left", width: "100%" }}
    >
      <div style={{ alignItems: "start", display: "flex", gap: 14, justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <p className="mono" style={{ margin: 0, overflowWrap: "anywhere" }}>Case {item.caseId}</p>
          <strong style={{ display: "block", marginTop: 5 }}>{item.evidenceMime}</strong>
        </div>
        <Badge tone={item.stateTone}>{item.stateLabel}</Badge>
      </div>
      <div className="muted" style={{ display: "flex", flexWrap: "wrap", gap: "5px 14px", marginTop: 12 }}>
        <small>Created {item.createdAt}</small>
        <small>Completed {item.completedAt}</small>
      </div>
      <div aria-label="Case versions" style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 12 }}>
        {item.versions.map((version) => <span className="mono" key={version.label} style={{ border: "1px solid var(--border, #dde1eb)", borderRadius: 999, fontSize: 11, padding: "4px 7px" }}>{version.label} {version.value}</span>)}
      </div>
    </button>
  </Card>;
}
