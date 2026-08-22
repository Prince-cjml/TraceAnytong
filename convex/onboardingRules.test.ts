import assert from "node:assert/strict";
import test from "node:test";
import {
  assertInvitationRole,
  normalizedDisplayName,
  normalizedInvitationEmail,
  normalizedOrganizationName,
  normalizedOrganizationSlug,
} from "./onboardingRules.ts";

test("organization and invitation input has bounded canonical forms", () => {
  assert.equal(normalizedOrganizationName("  Northstar Bio "), "Northstar Bio");
  assert.equal(normalizedOrganizationSlug(" Northstar-Bio "), "northstar-bio");
  assert.equal(normalizedDisplayName(" Mara Klein "), "Mara Klein");
  assert.equal(normalizedInvitationEmail(" MEMBER@Example.com "), "member@example.com");
  assert.doesNotThrow(() => assertInvitationRole("investigator"));
  assert.throws(() => normalizedOrganizationSlug("northstar bio"), /INVALID_ORGANIZATION_SLUG/);
  assert.throws(() => normalizedInvitationEmail("not-an-email"), /INVALID_INVITATION_EMAIL/);
  assert.throws(() => assertInvitationRole("admin"), /INVALID_INVITATION_ROLE/);
});
