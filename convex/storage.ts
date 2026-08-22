import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./auth";
import { requireWorker } from "./workerAuth";

/** Direct-to-Convex upload URL. Metadata mutations bind the resulting storage ID immutably. */
export const createUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["issuer", "investigator", "admin"]);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Direct upload URL for a currently configured external worker. The URL is
 * intentionally created only after validating the worker's server credential;
 * callers still need the relevant job lease to associate the uploaded object.
 */
export const createWorkerUploadUrl = mutation({
  args: { workerToken: v.string() },
  handler: async (ctx, args) => {
    requireWorker(args.workerToken);
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
