import { mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  DEMO_ORGANIZATION,
  DEMO_PROFILES,
  DEMO_USERS,
  assertDevelopmentBootstrapAccess,
  profileMatchesFixture,
  userMatchesFixture,
} from "./bootstrapFixtures";

/**
 * Development-only bootstrap. It deliberately does not use browser auth: the
 * caller must possess the server-side secret configured in the deployment.
 * Do not configure DEV_BOOTSTRAP_ENVIRONMENT or DEV_BOOTSTRAP_SECRET in prod.
 */
function requireBootstrapAccess(secret: string): void {
  assertDevelopmentBootstrapAccess(
    secret,
    process.env.DEV_BOOTSTRAP_SECRET,
    process.env.DEV_BOOTSTRAP_ENVIRONMENT,
  );
}

export const bootstrap = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireBootstrapAccess(args.secret);
    const now = Date.now();
    let organization = await ctx.db.query("organizations").withIndex("by_slug", (q) => q.eq("slug", DEMO_ORGANIZATION.slug)).unique();
    if (organization && organization.name !== DEMO_ORGANIZATION.name) throw new Error("BOOTSTRAP_ORGANIZATION_CONFLICT");
    if (!organization) {
      const organizationId = await ctx.db.insert("organizations", { ...DEMO_ORGANIZATION, createdAt: now });
      organization = await ctx.db.get(organizationId);
    }
    if (!organization) throw new Error("BOOTSTRAP_ORGANIZATION_UNAVAILABLE");

    let createdUsers = 0;
    for (const fixture of DEMO_USERS) {
      const existing = await ctx.db.query("users").withIndex("by_org_subject", (q) => q.eq("orgId", organization!._id).eq("authSubject", fixture.authSubject)).unique();
      if (existing && !userMatchesFixture(existing, fixture)) throw new Error("BOOTSTRAP_USER_CONFLICT");
      if (!existing) {
        await ctx.db.insert("users", { orgId: organization._id, ...fixture, status: "active", createdAt: now });
        createdUsers += 1;
      }
    }

    let createdProfiles = 0;
    for (const fixture of DEMO_PROFILES) {
      const existing = await ctx.db.query("watermarkProfiles").withIndex("by_profileId", (q) => q.eq("profileId", fixture.profileId)).unique();
      if (existing && !profileMatchesFixture(existing, fixture)) throw new Error("BOOTSTRAP_PROFILE_CONFLICT");
      if (!existing) {
        await ctx.db.insert("watermarkProfiles", { ...fixture, createdAt: now });
        createdProfiles += 1;
      }
    }

    return {
      organizationId: organization._id,
      createdUsers,
      createdProfiles,
      userSubjects: DEMO_USERS.map(({ authSubject }) => authSubject),
      profileIds: DEMO_PROFILES.map(({ profileId }) => profileId),
    };
  },
});

/**
 * Idempotently removes only rows that are unquestionably owned by the fixture
 * organization. Profiles remain immutable/global and are intentionally kept.
 */
export const cleanup = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireBootstrapAccess(args.secret);
    const organization = await ctx.db.query("organizations").withIndex("by_slug", (q) => q.eq("slug", DEMO_ORGANIZATION.slug)).unique();
    if (!organization) return { removed: false, removedUsers: 0, removedAuditEvents: 0 };
    if (organization.name !== DEMO_ORGANIZATION.name) throw new Error("BOOTSTRAP_ORGANIZATION_CONFLICT");

    const [users, documents, issuances, sessions, jobs, traceCases, auditEvents] = await Promise.all([
      ctx.db.query("users").withIndex("by_org_role", (q) => q.eq("orgId", organization!._id)).take(100),
      ctx.db.query("documents").withIndex("by_org_updated", (q) => q.eq("orgId", organization!._id)).take(1),
      ctx.db.query("issuances").filter((q) => q.eq(q.field("orgId"), organization!._id)).take(1),
      ctx.db.query("webSessions").withIndex("by_route_time", (q) => q.eq("orgId", organization!._id)).take(1),
      ctx.db.query("jobs").filter((q) => q.eq(q.field("orgId"), organization!._id)).take(1),
      ctx.db.query("traceCases").withIndex("by_org_created", (q) => q.eq("orgId", organization!._id)).take(1),
      ctx.db.query("auditEvents").withIndex("by_org_time", (q) => q.eq("orgId", organization!._id)).take(100),
    ]);
    if (documents.length || issuances.length || sessions.length || jobs.length || traceCases.length) {
      throw new Error("BOOTSTRAP_CLEANUP_REQUIRES_EMPTY_DEMO_ORGANIZATION");
    }
    for (const user of users) {
      const fixture = DEMO_USERS.find((candidate) => candidate.authSubject === user.authSubject);
      if (!fixture || !userMatchesFixture(user, fixture)) throw new Error("BOOTSTRAP_CLEANUP_REQUIRES_FIXTURE_USERS");
    }
    for (const event of auditEvents) await ctx.db.delete(event._id);
    for (const user of users) await ctx.db.delete(user._id);
    await ctx.db.delete(organization._id);
    return { removed: true, removedUsers: users.length, removedAuditEvents: auditEvents.length };
  },
});
