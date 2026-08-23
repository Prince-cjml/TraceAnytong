import { describe, expect, it } from "vitest";
import { matchesProtectedSession, screenProfileNotice } from "./protected-content";

describe("protected screen profile selection", () => {
  it("does not invent a browser-side profile fallback", () => {
    expect(screenProfileNotice(undefined)).toBeNull();
    expect(screenProfileNotice({ available: true, profileId: "screen-v1", profileVersion: "1.0.0" })).toBeNull();
    expect(screenProfileNotice({ available: false, reason: "missing" })).toMatch(/no active screen profile/i);
    expect(screenProfileNotice({ available: false, reason: "ambiguous" })).toMatch(/ambiguous/i);
  });

  it("does not reuse a tile session when protected route or profile changes", () => {
    const session = {
      sessionId: "web_session_opaque" as never,
      routeScope: "/protected/reports/quarterly",
      profileId: "screen-v1",
    };

    expect(matchesProtectedSession(session, "/protected/reports/quarterly", "screen-v1")).toBe(true);
    expect(matchesProtectedSession(session, "/protected/reports/annual", "screen-v1")).toBe(false);
    expect(matchesProtectedSession(session, "/protected/reports/quarterly", "screen-v2")).toBe(false);
    expect(matchesProtectedSession(session, "/protected/reports/quarterly", null)).toBe(false);
  });
});
