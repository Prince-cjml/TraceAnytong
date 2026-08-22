import { describe, expect, it } from "vitest";
import { traceResultCopy } from "./workspace";

describe("trace result presentation", () => {
  it("keeps an insufficient decision explicitly non-attributive", () => {
    const copy = traceResultCopy("INSUFFICIENT");

    expect(copy.headline).toMatch(/not sufficient/i);
    expect(copy.body).toMatch(/No attribution is recorded/i);
    expect(copy.posture).toBe("No attribution recorded");
  });

  it("only describes a profile-threshold outcome for an attributable decision", () => {
    const copy = traceResultCopy("HIGH");

    expect(copy.body).toMatch(/immutable profile threshold/i);
    expect(copy.posture).toBe("Attribution threshold met");
  });
});
