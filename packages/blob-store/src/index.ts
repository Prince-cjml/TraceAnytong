/** Storage is intentionally provider-neutral; application code must not assume S3/R2 URLs. */
export interface BlobStore {
  createUploadUrl(): Promise<string>;
  getDownloadUrl(storageId: string): Promise<string | null>;
  delete(storageId: string): Promise<void>;
}

export function assertStorageId(storageId: string): string {
  if (typeof storageId !== "string" || storageId.trim().length === 0) {
    throw new Error("storageId must be a non-empty opaque storage identifier");
  }
  return storageId;
}

/** Useful for deterministic unit tests; it deliberately issues synthetic URLs only. */
export class MemoryBlobStore implements BlobStore {
  private readonly records = new Set<string>();
  private uploadCounter = 0;

  register(storageId: string): void {
    this.records.add(assertStorageId(storageId));
  }

  async createUploadUrl(): Promise<string> {
    this.uploadCounter += 1;
    return `memory://upload/${this.uploadCounter}`;
  }

  async getDownloadUrl(storageId: string): Promise<string | null> {
    return this.records.has(assertStorageId(storageId)) ? `memory://download/${storageId}` : null;
  }

  async delete(storageId: string): Promise<void> {
    this.records.delete(assertStorageId(storageId));
  }
}
