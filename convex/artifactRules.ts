export const SUPPORTED_ARTIFACT_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export type SupportedArtifactMime = (typeof SUPPORTED_ARTIFACT_MIMES)[number];

export type TraceCarrier = "image" | "screen" | "structure";

const IMAGE_ARTIFACT_MIMES = new Set<SupportedArtifactMime>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const NATIVE_DOCUMENT_ARTIFACT_MIMES = new Set<SupportedArtifactMime>([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function assertSupportedArtifactMime(mime: string): asserts mime is SupportedArtifactMime {
  if (!(SUPPORTED_ARTIFACT_MIMES as readonly string[]).includes(mime)) throw new Error("UNSUPPORTED_ARTIFACT_MIME");
}

/**
 * Fail trace intake before queueing when a profile cannot inspect the supplied
 * evidence. Screen profiles intentionally accept raster screenshots as well
 * as native documents; structure profiles inspect native document containers
 * only, and image profiles only implement raster image-code recovery.
 */
export function assertTraceProfileCompatibility(mime: SupportedArtifactMime, carrier: TraceCarrier): void {
  const compatible = carrier === "screen"
    || (carrier === "image" && IMAGE_ARTIFACT_MIMES.has(mime))
    || (carrier === "structure" && NATIVE_DOCUMENT_ARTIFACT_MIMES.has(mime));
  if (!compatible) throw new Error("TRACE_PROFILE_MIME_MISMATCH");
}
