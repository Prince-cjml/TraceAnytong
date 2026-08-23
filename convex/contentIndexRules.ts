export const CONTENT_INDEX_VERSION = "source-content-index-v1";
export const CONTENT_INDEX_PROFILE_ID = "source-content-index-v1";
export const PAGE_FINGERPRINT_VERSION = "perceptual-page-v1";
export const MAX_INDEX_PAGES = 200;

type SubmittedPage = {
  pageIndex: number;
  previewStorageId: string;
  sourcePageSha256: string;
  pHash: string;
  dHash: string;
  fingerprintVersion: string;
  featureStorageId?: string;
  featureSha256?: string;
  width: number;
  height: number;
};

const sha256 = /^[a-f0-9]{64}$/;
const hash64 = /^[a-f0-9]{16}$/;

export function assertContentIndexPages(pages: readonly SubmittedPage[], indexed: boolean): void {
  if (!Array.isArray(pages) || pages.length > MAX_INDEX_PAGES || (indexed && pages.length === 0)) throw new Error("INVALID_CONTENT_INDEX_PAGES");
  if (!indexed && pages.length !== 0) throw new Error("UNINDEXED_CONTENT_MUST_NOT_HAVE_PAGES");
  pages.forEach((page, pageIndex) => {
    if (!page || page.pageIndex !== pageIndex || !page.previewStorageId || !sha256.test(page.sourcePageSha256)
      || !hash64.test(page.pHash) || !hash64.test(page.dHash) || page.fingerprintVersion !== PAGE_FINGERPRINT_VERSION
      || !Number.isInteger(page.width) || !Number.isInteger(page.height) || page.width < 1 || page.height < 1 || page.width > 20_000 || page.height > 20_000) {
      throw new Error("INVALID_CONTENT_INDEX_PAGE");
    }
    const hasFeatureStorage = typeof page.featureStorageId === "string";
    const hasFeatureHash = typeof page.featureSha256 === "string";
    if (hasFeatureStorage !== hasFeatureHash || (hasFeatureHash && !sha256.test(page.featureSha256!))) throw new Error("INVALID_CONTENT_INDEX_FEATURE");
  });
}

/** Only deterministic tool/input/result metadata can be retained with an index. */
export function assertContentIndexEvidence(rawEvidence: unknown): void {
  if (!rawEvidence || typeof rawEvidence !== "object" || Array.isArray(rawEvidence)) throw new Error("INVALID_CONTENT_INDEX_EVIDENCE");
  const evidence = rawEvidence as Record<string, unknown>;
  const allowed = new Set(["indexVersion", "input", "fingerprint", "decoder", "renderer", "result"]);
  if (Object.keys(evidence).some((key) => !allowed.has(key))) throw new Error("INVALID_CONTENT_INDEX_EVIDENCE");
  if (evidence.indexVersion !== CONTENT_INDEX_VERSION) throw new Error("INVALID_CONTENT_INDEX_EVIDENCE");
  // Rejecting arbitrary text fields prevents filenames, extracted text, and
  // other accidental source PII from becoming durable index evidence.
  if (JSON.stringify(evidence).length > 20_000 || /(?:filename|email|recipient|traceHandle)/i.test(JSON.stringify(evidence))) {
    throw new Error("INVALID_CONTENT_INDEX_EVIDENCE");
  }
}
