import assert from "node:assert/strict";
import test from "node:test";
import { canAccessSessionTile } from "./webSessionRules.ts";

test("web session tiles are limited to their recipient or an administrator", () => {
  assert.equal(canAccessSessionTile("user-a", "user-a", "viewer"), true);
  assert.equal(canAccessSessionTile("user-a", "user-b", "viewer"), false);
  assert.equal(canAccessSessionTile("user-a", "user-b", "investigator"), false);
  assert.equal(canAccessSessionTile("user-a", "user-b", "admin"), true);
});
