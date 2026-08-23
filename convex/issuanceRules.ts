export type RecipientStatus = "active" | "disabled";
export type PersonalizationCarrier = "image" | "screen" | "structure";

const IMAGE_PERSONALIZATION_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const SCREEN_PERSONALIZATION_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/** A disabled account may not receive new personalized derivatives. */
export function assertRecipientIsActive(status: RecipientStatus): void {
  if (status !== "active") throw new Error("RECIPIENT_NOT_ACTIVE");
}

/**
 * The personalization adapters preserve the source artifact's native MIME.
 * Resolve compatibility here, before an issuance or job can be written, so a
 * malformed browser request cannot queue work the worker must later reject.
 */
export function assertPersonalizationCompatibility({
  sourceMime,
  outputFormat,
  carrier,
}: {
  sourceMime: string;
  outputFormat: string;
  carrier: PersonalizationCarrier;
}): void {
  if (outputFormat !== sourceMime) throw new Error("OUTPUT_FORMAT_MISMATCH");
  if (carrier === "structure") throw new Error("STRUCTURE_CARRIER_PERSONALIZATION_UNSUPPORTED");
  if (IMAGE_PERSONALIZATION_MIME_TYPES.has(sourceMime)) {
    if (carrier !== "image") throw new Error("PERSONALIZATION_CARRIER_MIME_MISMATCH");
    return;
  }
  if (SCREEN_PERSONALIZATION_MIME_TYPES.has(sourceMime)) {
    if (carrier !== "screen") throw new Error("PERSONALIZATION_CARRIER_MIME_MISMATCH");
    return;
  }
  throw new Error("UNSUPPORTED_PERSONALIZATION_MIME");
}
