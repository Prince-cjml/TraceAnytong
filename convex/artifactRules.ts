export const SUPPORTED_ARTIFACT_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export type SupportedArtifactMime = (typeof SUPPORTED_ARTIFACT_MIMES)[number];

export function assertSupportedArtifactMime(mime: string): asserts mime is SupportedArtifactMime {
  if (!(SUPPORTED_ARTIFACT_MIMES as readonly string[]).includes(mime)) throw new Error("UNSUPPORTED_ARTIFACT_MIME");
}
