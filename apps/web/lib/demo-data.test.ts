import { describe, expect, it } from "vitest";
import { insufficientCandidate, shouldAttribute, traceCandidates } from "./demo-data";

describe("fixture decision policy", () => {
  it("keeps a high-margin candidate attributable", () => expect(shouldAttribute(traceCandidates[0])).toBe(true));
  it("never attributes an insufficient result", () => expect(shouldAttribute(insufficientCandidate)).toBe(false));
});
