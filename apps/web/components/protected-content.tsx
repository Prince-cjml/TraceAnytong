"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ForensicWatermarkLayer } from "@traceanytong/web-watermark";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useConvexDeploymentConfigured } from "./convex-client-provider";

type WebSession = { sessionId: Id<"webSessions"> };

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
  const profileId = process.env.NEXT_PUBLIC_SCREEN_PROFILE_ID ?? "document-screen";
  const tileUrl = useQuery(api.webSessions.getTileDownloadUrl, session ? { sessionId: session.sessionId } : "skip");

  useEffect(() => {
    if (isLoading || !isAuthenticated || session || error) return;
    const expiresAt = Date.now() + 4 * 60 * 60 * 1000;
    void createSession({ routeScope, profileId, epoch: Math.floor(Date.now() / 86_400_000), expiresAt })
      .then((created) => setSession({ sessionId: created.sessionId }))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to establish a protected session."));
  }, [createSession, error, isAuthenticated, isLoading, profileId, routeScope, session]);

  if (isLoading) return <ProtectedContentNotice state="checking" title="Checking access…" detail="A protected session will only be acquired after authentication succeeds." />;
  if (!isAuthenticated) return <ProtectedContentNotice state="blocked" title="Sign in required" detail="This route never creates a forensic web session for unauthenticated visitors." />;
  if (error) return <ProtectedContentNotice state="blocked" title="Protected session unavailable" detail={error} />;
  if (!session || tileUrl === undefined) return <ProtectedContentNotice state="checking" title="Preparing protected view…" detail="Creating a bounded anonymous session and waiting for its authorized watermark tile." />;
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
