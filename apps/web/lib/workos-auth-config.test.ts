import { describe, expect, it } from "vitest";
import { getWorkOSAccessToken, isWorkOSAuthBridgeEnabled } from "./workos-auth-config";

describe("WorkOS auth bridge configuration", () => {
  it("is disabled unless the deliberate public opt-in is exactly true", () => {
    expect(isWorkOSAuthBridgeEnabled({})).toBe(false);
    expect(isWorkOSAuthBridgeEnabled({ NEXT_PUBLIC_WORKOS_AUTH_ENABLED: "TRUE" })).toBe(false);
    expect(isWorkOSAuthBridgeEnabled({ NEXT_PUBLIC_WORKOS_AUTH_ENABLED: "true" })).toBe(true);
  });

  it("uses a refreshed WorkOS token only when Convex requests one", async () => {
    const calls: string[] = [];
    const tokenFunctions = {
      getAccessToken: async () => { calls.push("get"); return "current-token"; },
      refresh: async () => { calls.push("refresh"); return "fresh-token"; },
    };
    await expect(getWorkOSAccessToken(tokenFunctions)).resolves.toBe("current-token");
    await expect(getWorkOSAccessToken(tokenFunctions, true)).resolves.toBe("fresh-token");
    expect(calls).toEqual(["get", "refresh"]);
  });

  it("fails closed when the token provider cannot produce a token", async () => {
    await expect(getWorkOSAccessToken({
      getAccessToken: async () => { throw new Error("session unavailable"); },
      refresh: async () => undefined,
    })).resolves.toBeNull();
  });
});
