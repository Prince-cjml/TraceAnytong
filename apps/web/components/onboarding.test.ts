import { describe, expect, it } from "vitest";
import { onboardingErrorMessage, suggestedOrganizationSlug, validateInvitationDraft, validateOrganizationDraft } from "./onboarding";

describe("onboarding form guidance", () => {
  it("builds a deterministic, contract-compatible slug suggestion", () => {
    expect(suggestedOrganizationSlug(" Northstar Bio — R&D ")).toBe("northstar-bio-r-d");
    expect(suggestedOrganizationSlug("!@#$")).toBe("");
  });

  it("rejects organization drafts that cannot satisfy the server contract", () => {
    expect(validateOrganizationDraft({ name: "", slug: "northstar", displayName: "Avery" })).toMatch(/organization name/i);
    expect(validateOrganizationDraft({ name: "Northstar", slug: "North Star", displayName: "Avery" })).toMatch(/URL slug/i);
    expect(validateOrganizationDraft({ name: "Northstar", slug: "northstar", displayName: "Avery" })).toBeNull();
  });

  it("only permits the server-supported invitation roles and well-formed email guidance", () => {
    expect(validateInvitationDraft({ email: "not-an-email", role: "viewer" })).toMatch(/work email/i);
    expect(validateInvitationDraft({ email: "a@example.test", role: "admin" })).toMatch(/viewer, issuer, or investigator/i);
    expect(validateInvitationDraft({ email: "a@example.test", role: "investigator" })).toBeNull();
  });

  it("turns safe backend failures into actionable wording without disclosing internals", () => {
    expect(onboardingErrorMessage(new Error("ORGANIZATION_SLUG_TAKEN"))).toMatch(/already in use/i);
    expect(onboardingErrorMessage(new Error("unrelated server stack trace"))).toBe("We could not save your access changes. Please try again.");
  });
});
