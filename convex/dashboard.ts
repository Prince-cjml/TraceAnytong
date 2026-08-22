import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { currentUser } from "./auth";
import { activeTraceCaseCount, boundedDashboardCount, DASHBOARD_COUNT_LIMIT } from "./dashboardRules";

const scanLimit = DASHBOARD_COUNT_LIMIT + 1;

/**
 * Compact member-safe dashboard counts. The response contains no identities,
 * trace handles, storage IDs, evidence, worker tokens, or profile material.
 */
export const getSummary = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    const now = Date.now();
    const [organization, documents, ownSessions, traceCases] = await Promise.all([
      ctx.db.get(user.orgId as Id<"organizations">),
      ctx.db.query("documents").withIndex("by_org_updated", (q) => q.eq("orgId", user.orgId)).take(scanLimit),
      ctx.db.query("webSessions").withIndex("by_user_time", (q) => q.eq("userId", user._id)).order("desc").take(scanLimit),
      user.role === "investigator" || user.role === "admin"
        ? ctx.db.query("traceCases").withIndex("by_org_created", (q) => q.eq("orgId", user.orgId)).order("desc").take(scanLimit)
        : Promise.resolve(null),
    ]);
    const activeSessions = ownSessions.filter((session) => session.expiresAt > now);
    return {
      organizationName: organization?.name ?? "Organization",
      memberDisplayName: user.displayName,
      role: user.role,
      sourceDocuments: boundedDashboardCount(documents.length),
      activeOwnSessions: boundedDashboardCount(activeSessions.length),
      traceCases: traceCases === null ? null : {
        total: boundedDashboardCount(traceCases.length),
        open: boundedDashboardCount(activeTraceCaseCount(traceCases.map((traceCase) => traceCase.state))),
      },
    };
  },
});
