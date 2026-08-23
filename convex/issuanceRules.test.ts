import assert from "node:assert/strict";
import test from "node:test";
import { assertPersonalizationCompatibility, assertRecipientIsActive } from "./issuanceRules.ts";

test("disabled accounts cannot receive a new personalized issuance", () => {
  assert.doesNotThrow(() => assertRecipientIsActive("active"));
  assert.throws(() => assertRecipientIsActive("disabled"), /RECIPIENT_NOT_ACTIVE/);
});

test("personalized issuance accepts only native adapter and carrier pairs", () => {
  assert.doesNotThrow(() => assertPersonalizationCompatibility({
    sourceMime: "image/png", outputFormat: "image/png", carrier: "image",
  }));
  assert.doesNotThrow(() => assertPersonalizationCompatibility({
    sourceMime: "application/pdf", outputFormat: "application/pdf", carrier: "screen",
  }));
  assert.doesNotThrow(() => assertPersonalizationCompatibility({
    sourceMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    outputFormat: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    carrier: "screen",
  }));
  assert.doesNotThrow(() => assertPersonalizationCompatibility({
    sourceMime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    outputFormat: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    carrier: "screen",
  }));
});

test("personalized issuance fails closed for converted, mismatched, structure, and unsupported requests", () => {
  assert.throws(() => assertPersonalizationCompatibility({
    sourceMime: "image/jpeg", outputFormat: "image/png", carrier: "image",
  }), /OUTPUT_FORMAT_MISMATCH/);
  assert.throws(() => assertPersonalizationCompatibility({
    sourceMime: "image/webp", outputFormat: "image/webp", carrier: "screen",
  }), /PERSONALIZATION_CARRIER_MIME_MISMATCH/);
  assert.throws(() => assertPersonalizationCompatibility({
    sourceMime: "application/pdf", outputFormat: "application/pdf", carrier: "image",
  }), /PERSONALIZATION_CARRIER_MIME_MISMATCH/);
  assert.throws(() => assertPersonalizationCompatibility({
    sourceMime: "application/pdf", outputFormat: "application/pdf", carrier: "structure",
  }), /STRUCTURE_CARRIER_PERSONALIZATION_UNSUPPORTED/);
  assert.throws(() => assertPersonalizationCompatibility({
    sourceMime: "text/plain", outputFormat: "text/plain", carrier: "image",
  }), /UNSUPPORTED_PERSONALIZATION_MIME/);
});
