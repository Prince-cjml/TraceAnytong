"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState, type ChangeEvent } from "react";
import { api } from "../../../convex/_generated/api";

type ActiveProfile = {
  profileId: string;
  carrier: "image" | "screen" | "structure";
  profileVersion: string;
};

type RecipientChoice = { userId: string; displayName: string; role: string };

type IntakeFile = { name: string; type: string };

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const SUPPORTED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));
const IMAGE_PERSONALIZATION_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SCREEN_PERSONALIZATION_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/**
 * Maps browser-provided file metadata onto an adapter-supported artifact.
 * It deliberately yields no descriptor for unsupported content, so callers
 * cannot create a source version that the current worker registry rejects.
 */
export function documentIntakeDescriptor(file: IntakeFile) {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const inferredMime = MIME_BY_EXTENSION[extension];
  const browserMime = file.type.toLowerCase().split(";", 1)[0].trim();
  // Browser MIME is authoritative when present; infer from a filename only
  // when the browser genuinely supplied no type.
  const mime = browserMime ? (SUPPORTED_MIME_TYPES.has(browserMime) ? browserMime : undefined) : inferredMime;
  if (!mime || !SUPPORTED_MIME_TYPES.has(mime)) return null;
  const title = file.name.replace(/\.[^.]+$/, "").trim() || "Untitled source";
  return {
    title,
    mime,
    // The personalization worker preserves the native input type. This field
    // participates in its idempotency key; it does not request a conversion.
    outputFormat: mime,
  };
}

export function hasExplicitRecipientReference(value: string) {
  return value.trim().length > 0;
}

/** UI-only compatibility hint; Convex repeats and enforces this check before queueing. */
export function isProfileCompatibleWithSourceMime(profile: ActiveProfile, mime: string) {
  if (IMAGE_PERSONALIZATION_MIME_TYPES.has(mime)) return profile.carrier === "image";
  if (SCREEN_PERSONALIZATION_MIME_TYPES.has(mime)) return profile.carrier === "screen";
  return false;
}

export function compatibleProfilesForSourceMime(profiles: readonly ActiveProfile[], mime: string) {
  return profiles.filter((profile) => isProfileCompatibleWithSourceMime(profile, mime));
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type DocumentIntakeProps = {
  /** Invoked only after the immutable source version is successfully committed. */
  onCreated?: (result: { documentId: string; versionId: string; issuanceId?: string }) => void;
};

/**
 * Authenticated issuer/admin source intake. Recipients are selected as opaque
 * server IDs; identity is never embedded in a trace handle or sent to workers.
 * This surface does not expose detector scores or profile/key material.
 */
export function DocumentIntake({ onCreated }: DocumentIntakeProps) {
  const profiles = useQuery((api as any).watermarkProfiles.listActive, {}) as ActiveProfile[] | undefined;
  const recipients = useQuery((api as any).users.listIssuanceRecipients, {}) as RecipientChoice[] | undefined;
  const createUploadUrl = useMutation(api.storage.createUploadUrl);
  const createDocument = useMutation(api.documents.create);
  const addVersion = useMutation(api.documents.addVersion);
  const createIssuance = useMutation(api.issuances.create);
  const [file, setFile] = useState<File | null>(null);
  const [classification, setClassification] = useState("Confidential");
  const [recipientUserId, setRecipientUserId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [phase, setPhase] = useState<"idle" | "hashing" | "uploading" | "preserving" | "issuing" | "complete" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const descriptor = useMemo(() => file ? documentIntakeDescriptor(file) : null, [file]);
  const compatibleProfiles = useMemo(
    () => descriptor && profiles ? compatibleProfilesForSourceMime(profiles, descriptor.mime) : undefined,
    [descriptor, profiles],
  );
  const selectedProfile = useMemo(
    () => compatibleProfiles?.find((profile) => profile.profileId === profileId) ?? compatibleProfiles?.[0],
    [compatibleProfiles, profileId],
  );
  const wantsIssuance = hasExplicitRecipientReference(recipientUserId);
  const busy = ["hashing", "uploading", "preserving", "issuing"].includes(phase);
  const noCompatibleProfile = wantsIssuance && descriptor !== null && profiles !== undefined && compatibleProfiles?.length === 0;

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setError(selected && !documentIntakeDescriptor(selected) ? "Choose a supported PDF, DOCX, PPTX, PNG, JPEG, or WebP source." : null);
    setPhase("idle");
  };

  const submit = async () => {
    if (!file || !descriptor || busy) return;
    if (wantsIssuance && !selectedProfile) {
      setError("A protected copy requires an authorized active watermark profile.");
      return;
    }
    try {
      setError(null);
      setPhase("hashing");
      const sha256 = await sha256Hex(file);
      setPhase("uploading");
      const uploadUrl = await createUploadUrl({});
      const upload = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": descriptor.mime },
        body: file,
      });
      if (!upload.ok) throw new Error("Source upload was rejected by immutable storage.");
      const { storageId } = await upload.json() as { storageId?: string };
      if (!storageId) throw new Error("Storage did not return an immutable source ID.");
      setPhase("preserving");
      const documentId = await createDocument({ title: descriptor.title, classification });
      const versionId = await addVersion({
        documentId,
        sourceStorageId: storageId as any,
        sha256,
        mime: descriptor.mime,
        size: file.size,
        fingerprintVersion: "sha256-prefix-v1",
        // This is a deterministic source-integrity locator, not a detector score.
        coarseFingerprint: sha256.slice(0, 32),
      });
      let issuanceId: string | undefined;
      if (wantsIssuance && selectedProfile) {
        setPhase("issuing");
        const issuance = await createIssuance({
          versionId,
          recipientUserId: recipientUserId.trim() as any,
          profileId: selectedProfile.profileId,
          outputFormat: descriptor.outputFormat,
          workerClass: selectedProfile.carrier === "image" ? "gpu" : "cpu",
        });
        issuanceId = String(issuance.issuanceId);
      }
      setPhase("complete");
      onCreated?.({ documentId: String(documentId), versionId: String(versionId), issuanceId });
    } catch (submissionError) {
      setPhase("error");
      setError(submissionError instanceof Error ? submissionError.message : "The source could not be preserved.");
    }
  };

  const phaseCopy: Record<typeof phase, string | null> = {
    idle: null,
    hashing: "Hashing source bytes locally…",
    uploading: "Uploading source directly to immutable storage…",
    preserving: "Creating immutable document version…",
    issuing: "Queuing protected copy…",
    complete: wantsIssuance ? "Source preserved and protected copy queued." : "Immutable source version preserved.",
    error: null,
  };

  return <section className="document-intake" aria-label="New protected document">
    <div>
      <p className="eyebrow">IMMUTABLE SOURCE INTAKE</p>
      <h2>Preserve a source document</h2>
      <p>Source bytes are SHA-256 hashed in this browser, then uploaded directly to protected storage before any protected copy is queued.</p>
    </div>
    <label>Source file
      <input type="file" accept="application/pdf,.docx,.pptx,image/png,image/jpeg,image/webp" onChange={selectFile} disabled={busy} />
    </label>
    {file && <p className="muted">{descriptor ? `${descriptor.title} · ${descriptor.mime} · ${Math.ceil(file.size / 1024)} KB` : "Unsupported source type"}</p>}
    <label>Classification
      <select value={classification} onChange={(event) => setClassification(event.target.value)} disabled={busy}>
        <option>Internal</option><option>Confidential</option><option>Restricted</option>
      </select>
    </label>
    <fieldset>
      <legend>Optional protected copy</legend>
      <p className="muted">Leave this empty to preserve the source only. Select an authorized recipient to queue one personalized derivative; the opaque identifier stays server-side of the worker boundary.</p>
      <label>Recipient
        <select value={recipientUserId} onChange={(event) => setRecipientUserId(event.target.value)} disabled={busy || !recipients}>
          <option value="">Preserve source only</option>
          {recipients?.map((recipient) => <option key={recipient.userId} value={recipient.userId}>{recipient.displayName} · {recipient.role}</option>)}
        </select>
      </label>
      {wantsIssuance && <label>Watermark profile
        <select value={selectedProfile?.profileId ?? ""} onChange={(event) => setProfileId(event.target.value)} disabled={busy || !descriptor || !profiles || compatibleProfiles?.length === 0}>
          {!compatibleProfiles?.length && <option value="">No compatible active profile</option>}
          {compatibleProfiles?.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.profileId} · {profile.carrier}</option>)}
        </select>
      </label>}
    </fieldset>
    {phaseCopy[phase] && <p className="upload-status" role="status">{phaseCopy[phase]}</p>}
    {error && <p className="upload-error" role="alert">{error}</p>}
    {noCompatibleProfile && <p className="upload-error" role="alert">No active watermark profile can issue a native protected copy of this source type. You can still preserve the source without a recipient.</p>}
    <button className="primary" type="button" onClick={submit} disabled={!descriptor || busy || (wantsIssuance && !selectedProfile)}>
      {busy ? "Preserving…" : wantsIssuance ? "Preserve and issue copy" : "Preserve immutable source"} <span>→</span>
    </button>
    {wantsIssuance && profiles === undefined && <p className="muted">Loading authorized profile registry…</p>}
    {recipients === undefined && <p className="muted">Loading authorized recipients…</p>}
  </section>;
}
