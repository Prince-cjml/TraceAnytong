import assert from "node:assert/strict";
import test from "node:test";
import { assertRecipientIsActive } from "./issuanceRules.ts";

test("disabled accounts cannot receive a new personalized issuance", () => {
  assert.doesNotThrow(() => assertRecipientIsActive("active"));
  assert.throws(() => assertRecipientIsActive("disabled"), /RECIPIENT_NOT_ACTIVE/);
});
