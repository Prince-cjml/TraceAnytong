import { describe, expect, it } from "vitest";
import { screenProfileNotice } from "./protected-content";

describe("protected screen profile selection", () => {
  it("does not invent a browser-side profile fallback", () => {
    expect(screenProfileNotice(undefined)).toBeNull();
    expect(screenProfileNotice({ available: true, profileId: "screen-v1", profileVersion: "1.0.0" })).toBeNull();
    expect(screenProfileNotice({ available: false, reason: "missing" })).toMatch(/no active screen profile/i);
    expect(screenProfileNotice({ available: false, reason: "ambiguous" })).toMatch(/ambiguous/i);
  });
});
