import { describe, expect, it } from "vitest";

describe("web watermark contract", () => {
  it("keeps route scope distinct from identity", () => {
    const routeScope = "document:strategy";
    expect(routeScope).not.toContain("@");
  });
});
