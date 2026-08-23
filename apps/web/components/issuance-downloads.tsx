"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Badge, Card } from "@traceanytong/ui";
import { api } from "../../../convex/_generated/api";

export type DownloadableIssuance = {
  issuanceId: string;
  title: string;
  mime: string;
  status: "queued" | "processing" | "ready" | "failed";
  issuedAt: number;
  downloadedAt?: number;
  ready: boolean;
};

function issuanceStatusTone(status: DownloadableIssuance["status"]): "neutral" | "info" | "success" | "danger" {
  return status === "ready" ? "success" : status === "failed" ? "danger" : status === "processing" ? "info" : "neutral";
}

function mimeLabel(mime: string): string {
  if (mime === "application/pdf") return "PDF";
  if (mime.includes("wordprocessingml")) return "DOCX";
  if (mime.includes("presentationml")) return "PPTX";
  return mime.split("/").at(-1)?.toUpperCase() ?? "FILE";
}

/** Renders only server-authorized issuance metadata and fetches a bearer URL after an explicit user action. */
export function IssuanceDownloads() {
  const copies = useQuery((api as any).issuances.listAvailable, {}) as DownloadableIssuance[] | undefined;
  const markDownloaded = useMutation(api.issuances.markDownloaded);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadUrl = useQuery(api.issuances.getDownloadUrl, selectedId ? { issuanceId: selectedId as any } : "skip");

  useEffect(() => {
    if (!selectedId || downloadUrl === undefined) return;
    if (!downloadUrl) {
      setDownloadError("This protected copy is not ready for download.");
      setSelectedId(null);
      return;
    }
    void markDownloaded({ issuanceId: selectedId as any })
      .catch(() => setDownloadError("The download could not be recorded. The protected copy was not opened."));
    window.location.assign(downloadUrl);
    setSelectedId(null);
  }, [downloadUrl, markDownloaded, selectedId]);

  if (copies === undefined) return <Card className="live-document-note" aria-busy="true"><Badge tone="info">PROTECTED COPIES</Badge><h2>Loading authorized copies…</h2><p>Download links are requested only after the control plane checks this member’s access.</p></Card>;
  if (copies.length === 0) return <Card className="live-document-note"><Badge tone="info">PROTECTED COPIES</Badge><h2>No protected copies yet</h2><p>Upload a source and choose an authorized recipient to queue its separate personalized derivative.</p></Card>;
  return <Card className="table-card" aria-label="Authorized protected copy downloads">
    <div className="card-head"><div><p>Protected copies</p><strong>Authorized download registry</strong></div><Badge tone="info">ACCESS CHECKED</Badge></div>
    <div className="doc-table issuance-downloads">
      {copies.map((copy) => <div className="tr" key={copy.issuanceId}>
        <span className="document-title"><i className="violet">{mimeLabel(copy.mime)}</i><b>{copy.title}</b><small>Personalized derivative · issued {new Date(copy.issuedAt).toLocaleString()}</small></span>
        <span><Badge tone={issuanceStatusTone(copy.status)}>{copy.status}</Badge></span>
        <span className="muted">{copy.downloadedAt ? "Downloaded" : "Not downloaded"}</span>
        <button className="secondary" type="button" disabled={!copy.ready || selectedId !== null} onClick={() => { setDownloadError(null); setSelectedId(copy.issuanceId); }}>
          {selectedId === copy.issuanceId ? "Authorizing…" : copy.ready ? "Download copy" : copy.status === "failed" ? "Generation failed" : "Generating…"}
        </button>
      </div>)}
    </div>
    {downloadError && <p className="upload-error" role="alert">{downloadError}</p>}
  </Card>;
}
