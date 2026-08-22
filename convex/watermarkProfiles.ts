import { query } from "./_generated/server";
import { requireRole } from "./auth";
import { selectActiveScreenProfile } from "./watermarkProfileRules";

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

/**
 * Protected views may use a screen carrier only when the control plane has one
 * unambiguous active screen profile. Browser configuration never chooses or
 * receives key material.
 */
export const getActiveScreenProfile = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["viewer", "issuer", "investigator", "admin"]);
    const profiles = await ctx.db.query("watermarkProfiles")
      .filter((q) => q.and(q.eq(q.field("status"), "active"), q.eq(q.field("carrier"), "screen")))
      .take(2);
    return selectActiveScreenProfile(profiles);
  },
});
