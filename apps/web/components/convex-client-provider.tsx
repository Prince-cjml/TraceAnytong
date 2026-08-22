"use client";

import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { createContext, useContext, useState, type ReactNode } from "react";

const deploymentUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const ConvexDeploymentContext = createContext(false);

/**
 * WorkOS is deliberately not guessed from browser state. Until its token bridge
 * is configured, Convex receives no token and protected queries stay disabled.
 */
function useUnconfiguredAuth() {
  return {
    isLoading: false,
    isAuthenticated: false,
    fetchAccessToken: async () => null,
  };
}

export function useConvexDeploymentConfigured() {
  return useContext(ConvexDeploymentContext);
}

/** Keeps all UI mutations and subscriptions on the configured Convex deployment. */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => deploymentUrl ? new ConvexReactClient(deploymentUrl) : null);
  if (!client) return <ConvexDeploymentContext.Provider value={false}>{children}</ConvexDeploymentContext.Provider>;
  return <ConvexDeploymentContext.Provider value>
    <ConvexProviderWithAuth client={client} useAuth={useUnconfiguredAuth}>{children}</ConvexProviderWithAuth>
  </ConvexDeploymentContext.Provider>;
}
