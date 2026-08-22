import { query } from "./_generated/server";
import { requireRole } from "./auth";

/**
 * Investigator-safe profile chooser. It exposes immutable compatibility and
 * threshold metadata, never carrier secret material or key references.
 */
export const listActive = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["issuer", "investigator", "admin"]);
    const profiles = await ctx.db.query("watermarkProfiles").filter((q) => q.eq(q.field("status"), "active")).take(100);
    return profiles.map((profile) => ({
      profileId: profile.profileId,
      carrier: profile.carrier,
      protocolVersion: profile.protocolVersion,
      profileVersion: profile.profileVersion,
      detectorVersion: profile.detectorVersion,
      thresholds: profile.thresholds,
    }));
  },
});
