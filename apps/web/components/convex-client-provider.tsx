"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState, type ReactNode } from "react";

const deploymentUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

/** Keeps all UI mutations and subscriptions on the configured Convex deployment. */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => deploymentUrl ? new ConvexReactClient(deploymentUrl) : null);
  if (!client) return <>{children}</>;
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
