"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useMemo, useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";

export type InvitationRole = "viewer" | "issuer" | "investigator";

type AccessStatus =
  | { state: "member"; role: string }
  | { state: "unprovisioned"; canCreateOrganization: boolean };

type Invitation = {
  invitationId: string;
  organizationName: string;
  role: InvitationRole;
  expiresAt: number;
};

const invitationRoles: readonly InvitationRole[] = ["viewer", "issuer", "investigator"];

/** Mirrors the public organization-input contract before a mutation is attempted. */
export function validateOrganizationDraft(draft: { name: string; slug: string; displayName: string }): string | null {
  if (!draft.name.trim() || draft.name.trim().length > 120) return "Enter an organization name of up to 120 characters.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug.trim().toLowerCase()) || draft.slug.trim().length > 64) {
    return "Use a URL slug with lowercase letters, numbers, and single hyphens.";
  }
  if (!draft.displayName.trim() || draft.displayName.trim().length > 120) return "Enter the name your teammates should see.";
  return null;
}

/** Invitation addresses are normalized in the server too; this only gives immediate, accessible feedback. */
export function validateInvitationDraft(draft: { email: string; role: string }): string | null {
  const email = draft.email.trim();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid work email address.";
  if (!invitationRoles.includes(draft.role as InvitationRole)) return "Choose a viewer, issuer, or investigator role.";
  return null;
}

export function suggestedOrganizationSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

export function onboardingErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code.includes("ORGANIZATION_SLUG_TAKEN")) return "That organization URL is already in use. Choose another slug.";
  if (code.includes("ACCESS_ALREADY_PROVISIONED")) return "This WorkOS account already has workspace access.";
  if (code.includes("INVITATION_NOT_CLAIMABLE")) return "This invitation is no longer available for your verified email.";
  if (code.includes("INVITATION_ALREADY_PENDING")) return "A pending invitation already exists for that email address.";
  return "We could not save your access changes. Please try again.";
}

function OrganizationCreator({ onProvisioned }: { onProvisioned?: () => void }) {
  const createOrganization = useMutation((api as any).onboarding.createOrganization);
  const nameId = useId();
  const slugId = useId();
  const displayNameId = useId();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = { name, slug: slug.trim().toLowerCase(), displayName };
    const validation = validateOrganizationDraft(draft);
    if (validation) return setError(validation);
    try {
      setBusy(true);
      setError(null);
      await createOrganization(draft);
      onProvisioned?.();
    } catch (submissionError) {
      setError(onboardingErrorMessage(submissionError));
    } finally {
      setBusy(false);
    }
  };

  return <form className="document-intake" onSubmit={submit} noValidate>
    <div>
      <p className="eyebrow">CREATE YOUR WORKSPACE</p>
      <h2>Start with a verified organization</h2>
      <p>You are creating the first administrator account. Trace identities remain anonymous and are never derived from your name or email.</p>
    </div>
    <label htmlFor={nameId}>Organization name
      <input id={nameId} value={name} autoComplete="organization" maxLength={120} disabled={busy} onChange={(event) => {
        const nextName = event.target.value;
        setName(nextName);
        if (!slug) setSlug(suggestedOrganizationSlug(nextName));
      }} />
    </label>
    <label htmlFor={slugId}>Organization URL
      <input id={slugId} value={slug} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={64} disabled={busy} onChange={(event) => setSlug(event.target.value.toLowerCase())} aria-describedby={`${slugId}-hint`} />
      <span id={`${slugId}-hint`} className="muted">Lowercase letters, numbers, and hyphens only.</span>
    </label>
    <label htmlFor={displayNameId}>Your display name
      <input id={displayNameId} value={displayName} autoComplete="name" maxLength={120} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} />
    </label>
    {error && <p className="upload-error" role="alert">{error}</p>}
    <button className="primary" type="submit" disabled={busy}>{busy ? "Creating workspace…" : "Create organization"} <span>→</span></button>
  </form>;
}

function InvitationClaims({ invitations, onProvisioned }: { invitations: readonly Invitation[]; onProvisioned?: () => void }) {
  const claimInvitation = useMutation((api as any).onboarding.claimInvitation);
  const displayNameId = useId();
  const [displayName, setDisplayName] = useState("");
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const claim = async (invitationId: string) => {
    const trimmedName = displayName.trim();
    if (!trimmedName || trimmedName.length > 120) return setError("Enter the name your teammates should see.");
    try {
      setBusyInvitationId(invitationId);
      setError(null);
      await claimInvitation({ invitationId: invitationId as any, displayName: trimmedName });
      onProvisioned?.();
    } catch (submissionError) {
      setError(onboardingErrorMessage(submissionError));
    } finally {
      setBusyInvitationId(null);
    }
  };

  if (!invitations.length) return null;
  return <section className="document-intake" aria-labelledby="invitation-heading">
    <div>
      <p className="eyebrow">YOUR INVITATIONS</p>
      <h2 id="invitation-heading">Join a verified workspace</h2>
      <p>Each invitation is bound to your authenticated WorkOS email. Its organization, role, and eligibility are checked again by the server when you claim it.</p>
    </div>
    <label htmlFor={displayNameId}>Your display name
      <input id={displayNameId} value={displayName} autoComplete="name" maxLength={120} disabled={busyInvitationId !== null} onChange={(event) => setDisplayName(event.target.value)} />
    </label>
    <div className="profile-panel" aria-label="Available workspace invitations" style={{ width: "100%", display: "grid", gap: 10 }}>
      {invitations.map((invitation) => <div key={invitation.invitationId} className="setting-row">
        <div><b>{invitation.organizationName}</b><p>Role: {invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</p></div>
        <button type="button" className="primary" disabled={busyInvitationId !== null} onClick={() => void claim(invitation.invitationId)}>{busyInvitationId === invitation.invitationId ? "Joining…" : "Claim invitation"}</button>
      </div>)}
    </div>
    {error && <p className="upload-error" role="alert">{error}</p>}
  </section>;
}

function AdminInvitationForm() {
  const createInvitation = useMutation((api as any).onboarding.createInvitation);
  const emailId = useId();
  const roleId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateInvitationDraft({ email, role });
    if (validation) return setError(validation);
    try {
      setBusy(true);
      setError(null);
      setSuccess(null);
      const result = await createInvitation({ email: email.trim().toLowerCase(), role });
      const expiry = result?.expiresAt ? new Date(result.expiresAt).toLocaleDateString() : "in seven days";
      setSuccess(`Invitation created and valid until ${expiry}. Delivery is handled by your organization’s configured product layer.`);
      setEmail("");
    } catch (submissionError) {
      setError(onboardingErrorMessage(submissionError));
    } finally {
      setBusy(false);
    }
  };

  return <section className="document-intake" aria-labelledby="admin-invitation-heading">
    <div>
      <p className="eyebrow">ADMINISTRATOR</p>
      <h2 id="admin-invitation-heading">Invite a verified teammate</h2>
      <p>Roles and email eligibility are verified on the server. Invitations never grant access until the recipient claims one from the matching authenticated WorkOS email.</p>
    </div>
    <form className="document-intake" onSubmit={submit} noValidate>
      <label htmlFor={emailId}>Work email
        <input id={emailId} type="email" value={email} autoComplete="email" maxLength={320} disabled={busy} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label htmlFor={roleId}>Workspace role
        <select id={roleId} value={role} disabled={busy} onChange={(event) => setRole(event.target.value as InvitationRole)}>
          <option value="viewer">Viewer — view protected content</option>
          <option value="issuer">Issuer — create protected copies</option>
          <option value="investigator">Investigator — analyze evidence</option>
        </select>
      </label>
      {success && <p className="upload-status" role="status">{success}</p>}
      {error && <p className="upload-error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? "Creating invitation…" : "Create invitation"} <span>→</span></button>
    </form>
  </section>;
}

export type OnboardingProps = { onProvisioned?: () => void };

/**
 * A WorkOS-authenticated entry surface. Non-admin members get a hidden sentinel
 * so parent layouts can remain completely unchanged once access is provisioned.
 */
export function Onboarding({ onProvisioned }: OnboardingProps) {
  const access = useQuery((api as any).onboarding.accessStatus, {}) as AccessStatus | undefined;
  const invitations = useQuery((api as any).onboarding.listMyInvitations, access?.state === "unprovisioned" && access.canCreateOrganization ? {} : "skip") as Invitation[] | undefined;
  const isAdmin = access?.state === "member" && access.role === "admin";
  const canCreate = access?.state === "unprovisioned" && access.canCreateOrganization;
  const visibleInvitations = useMemo(() => invitations ?? [], [invitations]);

  if (access?.state === "member" && !isAdmin) return <span data-onboarding-state="member" hidden />;
  if (isAdmin) return <AdminInvitationForm />;
  if (!access) return <span data-onboarding-state="loading" hidden />;
  if (!canCreate) return <section className="document-intake" aria-label="Workspace access required"><div><p className="eyebrow">VERIFIED EMAIL REQUIRED</p><h2>Complete your WorkOS sign-in</h2><p>Workspace creation and invitations are available after WorkOS provides a verified email address for this session.</p></div></section>;

  return <section className="document-intake" aria-label="Workspace onboarding">
    <OrganizationCreator onProvisioned={onProvisioned} />
    {invitations === undefined ? <p className="muted" role="status">Checking invitations for your verified WorkOS email…</p> : <InvitationClaims invitations={visibleInvitations} onProvisioned={onProvisioned} />}
  </section>;
}
