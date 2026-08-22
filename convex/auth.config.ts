import type { AuthConfig } from "convex/server";

/**
 * WorkOS AuthKit JWT validation. `WORKOS_CLIENT_ID` is intentionally configured
 * per Convex deployment so development and production never share an issuer
 * audience by accident. Leaving it absent keeps the deployment unauthenticated
 * rather than accepting an invented fallback issuer.
 */
const clientId = process.env.WORKOS_CLIENT_ID;

export default {
  providers: clientId ? [
    {
      type: "customJwt",
      issuer: "https://api.workos.com/",
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
    },
  ] : [],
} satisfies AuthConfig;
