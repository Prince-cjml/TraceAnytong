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

export function acceptedEvidenceLabel(mimeType: string) {
  if (mimeType.startsWith("image/")) return "Image evidence";
  if (mimeType === "application/pdf") return "PDF evidence";
  if (mimeType.includes("wordprocessingml.document")) return "DOCX evidence";
  if (mimeType.includes("presentationml.presentation")) return "PPTX evidence";
  return "Evidence file";
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Authenticated, direct-to-storage evidence intake. Browser code never sees worker or profile secrets. */
export function TraceEvidenceUploader({ onCaseCreated }: { onCaseCreated: (caseId: string) => void }) {
  const profiles = useQuery((api as any).watermarkProfiles.listActive, {}) as ProfileChoice[] | undefined;
  const createUploadUrl = useMutation(api.storage.createUploadUrl);
  const createCase = useMutation(api.traceCases.create);
  const [file, setFile] = useState<File | null>(null);
  const [profileId, setProfileId] = useState("");
  const [status, setStatus] = useState<"idle" | "hashing" | "uploading" | "creating" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const selectedProfile = useMemo(() => profiles?.find((profile) => profile.profileId === profileId) ?? profiles?.[0], [profileId, profiles]);

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setError(null);
    setStatus("idle");
  };

  const submit = async () => {
    if (!file || !selectedProfile) return;
    try {
      setError(null);
      setStatus("hashing");
      const sha256 = await sha256Hex(file);
      setStatus("uploading");
      const uploadUrl = await createUploadUrl({});
      const uploadResponse = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!uploadResponse.ok) throw new Error("Evidence upload was rejected by storage.");
      const { storageId } = await uploadResponse.json() as { storageId?: string };
      if (!storageId) throw new Error("Evidence upload did not return an immutable storage ID.");
      setStatus("creating");
      const caseId = await createCase({
        evidenceStorageId: storageId as any,
        evidenceSha256: sha256,
        evidenceMime: file.type || "application/octet-stream",
        profileId: selectedProfile.profileId,
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
    <div className="dropzone"><div className="upload-glyph">↑</div><h2>{file ? file.name : "Drop leak evidence here"}</h2><p>{file ? `${acceptedEvidenceLabel(file.type)} · the original will be hashed before processing.` : "Screenshots, photos, PDFs, Office documents and images are supported."}</p><div><label className="file-button">Choose file<input type="file" accept="image/*,application/pdf,.docx,.pptx" onChange={selectFile} disabled={busy} /></label><span>or drag and drop</span></div>{file && <div className="file-preview"><span>{file.type.split("/").at(-1)?.toUpperCase() || "FILE"}</span><b>{file.name}</b><small>{Math.ceil(file.size / 1024)} KB · SHA-256 will be calculated locally</small><button onClick={() => setFile(null)} disabled={busy}>×</button></div>}</div>
    <div className="trace-side-note"><span className="badge info">LIVE EVIDENCE INTAKE</span><h3>Preserve first. Process second.</h3><p>The upload is sent directly to immutable storage. Only an authorized investigator can create this case.</p><label className="profile-select">Detection profile<select value={selectedProfile?.profileId ?? ""} onChange={(event) => setProfileId(event.target.value)} disabled={busy || !profiles}>{profiles?.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.profileId} · {profile.carrier}</option>)}</select></label>{statusText && <p className="upload-status" role="status">{statusText}</p>}{error && <p className="upload-error" role="alert">{error}</p>}<button className="primary" disabled={!file || !selectedProfile || busy} onClick={submit}>{busy ? "Preserving evidence…" : "Preserve and analyze"} <span>→</span></button>{profiles === undefined && <p className="muted">Loading authorized profile registry…</p>}</div>
  </div>;
}
