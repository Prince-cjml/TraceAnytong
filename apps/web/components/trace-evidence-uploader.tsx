"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState, type ChangeEvent } from "react";
import { api } from "../../../convex/_generated/api";

type ProfileChoice = {
  profileId: string;
  carrier: "image" | "screen" | "structure";
  protocolVersion: string;
  profileVersion: string;
  detectorVersion: string;
};

type AuthorizedDocument = {
  _id: string;
  title: string;
  classification: string;
};

export type AuthorizedDocumentChoice = {
  documentId: string;
  label: string;
};

const supportedMimeByExtension: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const supportedMimes = new Set(Object.values(supportedMimeByExtension));

export function normalizedArtifactMime(file: Pick<File, "name" | "type">): string | null {
  const reportedMime = file.type.toLowerCase().split(";", 1)[0].trim();
  if (reportedMime) return supportedMimes.has(reportedMime) ? reportedMime : null;
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  return extension ? supportedMimeByExtension[extension] ?? null : null;
}

export function acceptedEvidenceLabel(mimeType: string) {
  if (mimeType.startsWith("image/")) return "Image evidence";
  if (mimeType === "application/pdf") return "PDF evidence";
  if (mimeType.includes("wordprocessingml.document")) return "DOCX evidence";
  if (mimeType.includes("presentationml.presentation")) return "PPTX evidence";
  return "Evidence file";
}

/** Project only the authorized document metadata needed to present investigator context. */
export function projectAuthorizedDocumentChoices(documents: readonly AuthorizedDocument[] | undefined): AuthorizedDocumentChoice[] {
  if (!documents) return [];
  return documents.map((document) => ({
    documentId: String(document._id),
    label: `${document.title} · ${document.classification}`,
  }));
}

/** A stale, loading, or unauthorized selection must never be submitted to the control plane. */
export function selectedAuthorizedDocumentId(
  choices: readonly AuthorizedDocumentChoice[],
  selectedId: string,
): string | undefined {
  return choices.some((choice) => choice.documentId === selectedId) ? selectedId : undefined;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Authenticated, direct-to-storage evidence intake. Browser code never sees worker or profile secrets. */
export function TraceEvidenceUploader({ onCaseCreated }: { onCaseCreated: (caseId: string) => void }) {
  const profiles = useQuery((api as any).watermarkProfiles.listActive, {}) as ProfileChoice[] | undefined;
  const documents = useQuery(api.documents.list, {}) as AuthorizedDocument[] | undefined;
  const createUploadUrl = useMutation(api.storage.createUploadUrl);
  const createCase = useMutation(api.traceCases.create);
  const [file, setFile] = useState<File | null>(null);
  const [profileId, setProfileId] = useState("");
  const [suspectedDocumentId, setSuspectedDocumentId] = useState("");
  const [status, setStatus] = useState<"idle" | "hashing" | "uploading" | "creating" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const selectedProfile = useMemo(() => profiles?.find((profile) => profile.profileId === profileId) ?? profiles?.[0], [profileId, profiles]);
  const documentChoices = useMemo(() => projectAuthorizedDocumentChoices(documents), [documents]);
  const selectedDocumentId = selectedAuthorizedDocumentId(documentChoices, suspectedDocumentId);

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    if (next && !normalizedArtifactMime(next)) {
      setFile(null);
      setStatus("error");
      setError("Choose a JPEG, PNG, WebP, PDF, DOCX, or PPTX file.");
      return;
    }
    setFile(next);
    setError(null);
    setStatus("idle");
  };

  const submit = async () => {
    if (!file || !selectedProfile) return;
    try {
      const mime = normalizedArtifactMime(file);
      if (!mime) throw new Error("Choose a JPEG, PNG, WebP, PDF, DOCX, or PPTX file.");
      setError(null);
      setStatus("hashing");
      const sha256 = await sha256Hex(file);
      setStatus("uploading");
      const uploadUrl = await createUploadUrl({});
      const uploadResponse = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": mime }, body: file });
      if (!uploadResponse.ok) throw new Error("Evidence upload was rejected by storage.");
      const { storageId } = await uploadResponse.json() as { storageId?: string };
      if (!storageId) throw new Error("Evidence upload did not return an immutable storage ID.");
      setStatus("creating");
      const caseId = await createCase({
        evidenceStorageId: storageId as any,
        evidenceSha256: sha256,
        evidenceMime: mime,
        profileId: selectedProfile.profileId,
        ...(selectedDocumentId ? { suspectedDocumentId: selectedDocumentId as any } : {}),
        protocolVersion: selectedProfile.protocolVersion,
        detectorVersion: selectedProfile.detectorVersion,
        fingerprintVersion: "perceptual-v1",
      });
      onCaseCreated(String(caseId));
    } catch (submissionError) {
      setStatus("error");
      setError(submissionError instanceof Error ? submissionError.message : "Evidence could not be preserved.");
    }
  };

  const busy = status === "hashing" || status === "uploading" || status === "creating";
  const statusText = status === "hashing" ? "Hashing immutable source…" : status === "uploading" ? "Preserving original evidence…" : status === "creating" ? "Creating trace case…" : null;
  return <div className="trace-upload live-uploader">
    <div className="dropzone"><div className="upload-glyph">↑</div><h2>{file ? file.name : "Drop leak evidence here"}</h2><p>{file ? `${acceptedEvidenceLabel(normalizedArtifactMime(file) ?? file.type)} · the original will be hashed before processing.` : "JPEG, PNG, WebP, PDF, DOCX, and PPTX evidence is supported."}</p><div><label className="file-button">Choose file<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.docx,.pptx" onChange={selectFile} disabled={busy} /></label><span>or drag and drop</span></div>{file && <div className="file-preview"><span>{(normalizedArtifactMime(file) ?? file.type).split("/").at(-1)?.toUpperCase() || "FILE"}</span><b>{file.name}</b><small>{Math.ceil(file.size / 1024)} KB · SHA-256 will be calculated locally</small><button onClick={() => setFile(null)} disabled={busy}>×</button></div>}</div>
    <div className="trace-side-note"><span className="badge info">LIVE EVIDENCE INTAKE</span><h3>Preserve first. Process second.</h3><p>The upload is sent directly to immutable storage. Only an authorized investigator can create this case.</p><label className="profile-select">Detection profile<select value={selectedProfile?.profileId ?? ""} onChange={(event) => setProfileId(event.target.value)} disabled={busy || !profiles}>{profiles?.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.profileId} · {profile.carrier}</option>)}</select></label><label className="profile-select">Authorized source document <select value={selectedDocumentId ?? ""} onChange={(event) => setSuspectedDocumentId(event.target.value)} disabled={busy || !documents || documentChoices.length === 0} aria-describedby="suspected-document-help"><option value="">No document selected</option>{documentChoices.map((document) => <option key={document.documentId} value={document.documentId}>{document.label}</option>)}</select></label><p id="suspected-document-help" className="muted">Optional investigator context for server-scoped matching. It does not automatically match your upload to document content.</p>{statusText && <p className="upload-status" role="status">{statusText}</p>}{error && <p className="upload-error" role="alert">{error}</p>}<button className="primary" disabled={!file || !selectedProfile || busy} onClick={submit}>{busy ? "Preserving evidence…" : "Preserve and analyze"} <span>→</span></button>{profiles === undefined && <p className="muted">Loading authorized profile registry…</p>}{documents === undefined && <p className="muted">Loading authorized source documents…</p>}{documents?.length === 0 && <p className="muted">No authorized source documents are available.</p>}</div>
  </div>;
}
