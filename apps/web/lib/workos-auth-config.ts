export type PublicAuthEnvironment = Readonly<{
  NEXT_PUBLIC_WORKOS_AUTH_ENABLED?: string;
}>;

/**
 * Authentication is deliberately opt-in. This public switch must only be set
 * after the server-only WorkOS credentials and Convex JWT validation are both
 * configured; an absent switch leaves every Convex request unauthenticated.
 */
export function isWorkOSAuthBridgeEnabled(
  environment: PublicAuthEnvironment = {
    NEXT_PUBLIC_WORKOS_AUTH_ENABLED: process.env.NEXT_PUBLIC_WORKOS_AUTH_ENABLED,
  },
): boolean {
  return environment.NEXT_PUBLIC_WORKOS_AUTH_ENABLED === "true";
}

export type TokenFunctions = Readonly<{
  getAccessToken: () => Promise<string | undefined>;
  refresh: () => Promise<string | undefined>;
}>;

/** Never persist a WorkOS token: Convex asks for one only when it needs it. */
export async function getWorkOSAccessToken(
  functions: TokenFunctions,
  forceRefreshToken = false,
): Promise<string | null> {
  try {
    return (await (forceRefreshToken ? functions.refresh() : functions.getAccessToken())) ?? null;
  } catch {
    return null;
  }
}
