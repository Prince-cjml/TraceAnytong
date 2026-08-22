import { query } from "./_generated/server";
import { requireRole } from "./auth";

/**
 * Picker data for an issuer's own organization. It deliberately omits email
 * and all authentication material; the opaque user ID is used only by the
 * issuance mutation, which re-checks organization membership and status.
 */
export const listIssuanceRecipients = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireRole(ctx, ["issuer", "admin"]);
    const recipients = await ctx.db.query("users")
      .withIndex("by_org_status", (q) => q.eq("orgId", actor.orgId).eq("status", "active"))
      .take(100);
    return recipients
      .map((recipient) => ({ userId: recipient._id, displayName: recipient.displayName, role: recipient.role }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  },
});
