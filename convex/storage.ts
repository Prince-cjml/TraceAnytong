import { mutation } from "./_generated/server";
import { requireRole } from "./auth";

/** Direct-to-Convex upload URL. Metadata mutations bind the resulting storage ID immutably. */
export const createUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["issuer", "investigator", "admin"]);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Convex implementation of the provider-neutral BlobStore contract. It is an
 * internal adapter; public downloads must use entity-specific authorization.
 */
export class ConvexBlobStore {
  constructor(private readonly storage: { generateUploadUrl(): Promise<string>; getUrl(id: any): Promise<string | null>; delete(id: any): Promise<void> }) {}
  createUploadUrl(): Promise<string> { return this.storage.generateUploadUrl(); }
  getDownloadUrl(storageId: any): Promise<string | null> { return this.storage.getUrl(storageId); }
  delete(storageId: any): Promise<void> { return this.storage.delete(storageId); }
}
