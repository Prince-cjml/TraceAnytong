"use client";

import { AuthKitProvider, useAccessToken, useAuth } from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import { useCallback, useMemo, type ReactNode } from "react";
import { getWorkOSAccessToken } from "../lib/workos-auth-config";

/** Adapts AuthKit's short-lived access-token hook to Convex's auth contract. */
function useAuthFromWorkOS() {
  const { user, loading } = useAuth();
  const { getAccessToken, refresh } = useAccessToken();
  const fetchAccessToken = useCallback(
    (options: { forceRefreshToken?: boolean } = {}) => getWorkOSAccessToken(
      { getAccessToken, refresh },
      options.forceRefreshToken,
    ),
    [getAccessToken, refresh],
  );

  return useMemo(() => ({
    isLoading: loading,
    isAuthenticated: Boolean(user),
    fetchAccessToken,
  }), [fetchAccessToken, loading, user]);
}

export function WorkOSConvexClientProvider({ client, children }: { client: ConvexReactClient; children: ReactNode }) {
  return <AuthKitProvider>
    <ConvexProviderWithAuth client={client} useAuth={useAuthFromWorkOS}>{children}</ConvexProviderWithAuth>
  </AuthKitProvider>;
}
