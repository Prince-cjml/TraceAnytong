"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ForensicWatermarkLayer } from "@traceanytong/web-watermark";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useConvexDeploymentConfigured } from "./convex-client-provider";

type WebSession = {
  sessionId: Id<"webSessions">;
  routeScope: string;
  profileId: string;
};
type ScreenProfile = { available: true; profileId: string; profileVersion: string } | { available: false; reason: "missing" | "ambiguous" };

export function screenProfileNotice(profile: ScreenProfile | null | undefined): string | null {
  if (profile === undefined) return null;
  if (profile === null || profile.available) return null;
  return profile.reason === "ambiguous"
    ? "Protected content is withheld because the active screen profile registry is ambiguous."
    : "Protected content is withheld because no active screen profile is configured.";
}

/** A route or immutable profile change must never reuse another view's tile. */
export function matchesProtectedSession(session: WebSession | null, routeScope: string, profileId: string | null): boolean {
  return Boolean(session && profileId && session.routeScope === routeScope && session.profileId === profileId);
}

export function ProtectedContent({ routeScope }: { routeScope: string }) {
  const configured = useConvexDeploymentConfigured();
  if (!configured) return <ProtectedContentNotice title="Protected content requires a configured control plane." detail="No web session or watermark is created in local demo mode." />;
  return <AuthenticatedProtectedContent routeScope={routeScope} />;
}

function AuthenticatedProtectedContent({ routeScope }: { routeScope: string }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const createSession = useMutation(api.webSessions.createOrReuse);
  const [session, setSession] = useState<WebSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const screenProfile = useQuery((api as any).watermarkProfiles.getActiveScreenProfile, isAuthenticated ? {} : "skip") as ScreenProfile | undefined;
  const profileId = screenProfile?.available ? screenProfile.profileId : null;
  const sessionMatches = matchesProtectedSession(session, routeScope, profileId);
  const tileUrl = useQuery(api.webSessions.getTileDownloadUrl, sessionMatches && session ? { sessionId: session.sessionId } : "skip");

  useEffect(() => {
    // The App Router can retain this client component between protected routes.
    // Clear the old opaque session before a new scope/profile can render.
    setSession(null);
    setError(null);
  }, [profileId, routeScope]);

  useEffect(() => {
    if (isLoading || !isAuthenticated || !profileId || sessionMatches || error) return;
    let cancelled = false;
    const expiresAt = Date.now() + 4 * 60 * 60 * 1000;
    void createSession({ routeScope, profileId, epoch: Math.floor(Date.now() / 86_400_000), expiresAt })
      .then((created) => {
        if (!cancelled) setSession({ sessionId: created.sessionId, routeScope, profileId });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to establish a protected session.");
      });
    return () => { cancelled = true; };
  }, [createSession, error, isAuthenticated, isLoading, profileId, routeScope, sessionMatches]);

  if (isLoading) return <ProtectedContentNotice state="checking" title="Checking access…" detail="A protected session will only be acquired after authentication succeeds." />;
  if (!isAuthenticated) return <ProtectedContentNotice state="blocked" title="Sign in required" detail="This route never creates a forensic web session for unauthenticated visitors." />;
  if (screenProfile === undefined) return <ProtectedContentNotice state="checking" title="Preparing protected view…" detail="Loading the authorized screen-carrier profile." />;
  const profileNotice = screenProfileNotice(screenProfile);
  if (profileNotice) return <ProtectedContentNotice state="blocked" title="Protected profile unavailable" detail={profileNotice} />;
  if (error) return <ProtectedContentNotice state="blocked" title="Protected session unavailable" detail={error} />;
  if (!sessionMatches || !session || tileUrl === undefined) return <ProtectedContentNotice state="checking" title="Preparing protected view…" detail="Creating a bounded anonymous session and waiting for its authorized watermark tile." />;
  if (!tileUrl) return <ProtectedContentNotice state="blocked" title="Watermark tile unavailable" detail="This authenticated view fails closed until the control plane returns an authorized session-specific tile URL." />;

  return <main className="protected-content">
    <ForensicWatermarkLayer tileUrl={tileUrl} routeScope={routeScope} />
    <article>
      <div className="protected-status"><span>●</span> Session verified · static carrier active</div>
      <p className="crumb">PROTECTED CONTENT <span>/</span> AUTHORIZED VIEW</p>
      <h1>Forensic protected document</h1>
      <p>This route confirms access before rendering a static, pointer-safe screen carrier. Tile pixels are returned through an authorized control-plane URL; the session identifier and carrier material remain server-side.</p>
      <section><h2>Authorized material</h2><p>Replace this route body with the protected document renderer. Keep interactive content below the fixed watermark layer; its pointer events are permanently disabled.</p></section>
      <dl className="protection-facts"><div><dt>Carrier</dt><dd>Static session tile</dd></div><div><dt>Access</dt><dd>Bounded and authorized</dd></div><div><dt>Interaction</dt><dd>Pointer-safe overlay</dd></div></dl>
    </article>
  </main>;
}

function ProtectedContentNotice({ title, detail, state }: { title: string; detail: string; state?: "checking" | "blocked" }) {
  return <main className="protected-content protected-content--notice"><article aria-live="polite"><div className={`protected-status protected-status--${state ?? "checking"}`}><span>{state === "blocked" ? "!" : "◌"}</span> {state === "blocked" ? "Content remains withheld" : "Authorization in progress"}</div><p className="crumb">PROTECTED CONTENT</p><h1>{title}</h1><p>{detail}</p><section><h2>Why this is safe</h2><p>Protected content is never rendered beneath a missing or unauthorized watermark tile. Resolve access or try again after the control plane is available.</p></section></article></main>;
}
