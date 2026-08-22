import assert from "node:assert/strict";
import test from "node:test";
import { selectActiveScreenProfile } from "./watermarkProfileRules.ts";

test("protected views select only one active screen profile", () => {
  assert.deepEqual(selectActiveScreenProfile([]), { available: false, reason: "missing" });
  assert.deepEqual(selectActiveScreenProfile([{ profileId: "screen-v1", profileVersion: "1.0.0", carrier: "screen", status: "active" }]), { available: true, profileId: "screen-v1", profileVersion: "1.0.0" });
  assert.deepEqual(selectActiveScreenProfile([
    { profileId: "screen-v1", profileVersion: "1.0.0", carrier: "screen", status: "active" },
    { profileId: "screen-v2", profileVersion: "2.0.0", carrier: "screen", status: "active" },
  ]), { available: false, reason: "ambiguous" });
});
