import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_ORGANIZATION,
  DEMO_PROFILES,
  DEMO_USERS,
  assertDevelopmentBootstrapAccess,
  profileMatchesFixture,
  userMatchesFixture,
} from "./bootstrapFixtures.ts";

test("development bootstrap fixtures are deterministic and contain no real-person identifiers", () => {
  assert.equal(DEMO_ORGANIZATION.slug, "traceanytong-dev-demo");
  assert.equal(DEMO_USERS.length, 4);
  assert.equal(new Set(DEMO_USERS.map((user) => user.role)).size, 4);
  for (const user of DEMO_USERS) {
    assert.match(user.authSubject, /^traceanytong-dev-demo:[a-z]+$/);
    assert.match(user.email, /^[a-z]+@traceanytong-demo\.invalid$/);
  }
  assert.equal(DEMO_PROFILES.length, 3);
  assert.equal(new Set(DEMO_PROFILES.map((profile) => profile.carrier)).size, 3);
  assert.ok(DEMO_PROFILES.every((profile) => profile.protocolVersion === "0.1" && profile.profileVersion === "1.0.0"));
});

test("fixture bootstrap is idempotent only when immutable rows exactly match", () => {
  const profile = DEMO_PROFILES[0];
  assert.equal(profileMatchesFixture({ ...profile, _id: "ignored" }, profile), true);
  assert.equal(profileMatchesFixture({ ...profile, detectorVersion: "changed" }, profile), false);
  const user = DEMO_USERS[0];
  assert.equal(userMatchesFixture({ ...user, status: "active" }, user), true);
  assert.equal(userMatchesFixture({ ...user, status: "disabled" }, user), false);
});

test("bootstrap needs the remotely configured secret and explicit development mode", () => {
  assert.throws(() => assertDevelopmentBootstrapAccess("x", undefined, "development"), /DEV_BOOTSTRAP_DISABLED/);
  assert.throws(() => assertDevelopmentBootstrapAccess("x", "x", undefined), /DEV_BOOTSTRAP_DISABLED/);
  assert.throws(() => assertDevelopmentBootstrapAccess("wrong", "correct", "development"), /FORBIDDEN/);
  assert.doesNotThrow(() => assertDevelopmentBootstrapAccess("correct", "correct", "development"));
});
