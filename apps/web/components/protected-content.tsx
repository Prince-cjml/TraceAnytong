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

  if (isLoading) return <ProtectedContentNotice title="Checking access…" detail="A protected session will only be acquired after authentication succeeds." />;
  if (!isAuthenticated) return <ProtectedContentNotice title="Sign in required" detail="This route never creates a forensic web session for unauthenticated visitors." />;
  if (error) return <ProtectedContentNotice title="Protected session unavailable" detail={error} />;
  if (!session || tileUrl === undefined) return <ProtectedContentNotice title="Preparing protected view…" detail="Creating a bounded anonymous session and waiting for its authorized watermark tile." />;
  if (!tileUrl) return <ProtectedContentNotice title="Watermark tile unavailable" detail="This authenticated view fails closed until the control plane returns an authorized session-specific tile URL." />;

  return <main className="protected-content">
    <ForensicWatermarkLayer tileUrl={tileUrl} routeScope={routeScope} />
    <article>
      <p className="crumb">PROTECTED CONTENT <span>/</span> AUTHORIZED VIEW</p>
      <h1>Forensic protected document</h1>
      <p>This route confirms access before rendering a static, pointer-safe screen carrier. Tile pixels are returned through an authorized control-plane URL; the session identifier and carrier material remain server-side.</p>
      <section><h2>Authorized material</h2><p>Replace this route body with the protected document renderer. Keep interactive content below the fixed watermark layer; its pointer events are permanently disabled.</p></section>
    </article>
  </main>;
}

function ProtectedContentNotice({ title, detail }: { title: string; detail: string }) {
  return <main className="protected-content protected-content--notice"><article><p className="crumb">PROTECTED CONTENT</p><h1>{title}</h1><p>{detail}</p></article></main>;
}
