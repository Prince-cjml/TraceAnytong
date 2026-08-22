import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { currentIdentity, currentUser, requireIdentityEmail, requireRole } from "./auth";
import { writeAuditEvent } from "./audit";
import {
  assertInvitationRole,
  normalizedDisplayName,
  normalizedInvitationEmail,
  normalizedOrganizationName,
  normalizedOrganizationSlug,
} from "./onboardingRules";

const invitationRole = v.union(v.literal("viewer"), v.literal("issuer"), v.literal("investigator"));
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function auditHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Authenticated users learn whether they have a membership without exposing any other tenant data. */
export const accessStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await currentIdentity(ctx);
    const member = await ctx.db.query("users").withIndex("by_authSubject", (q) => q.eq("authSubject", identity.subject)).unique();
    return member && member.status === "active"
      ? { state: "member" as const, role: member.role }
      : { state: "unprovisioned" as const, canCreateOrganization: Boolean(identity.email) };
  },
});

/** Creates a tenant for the authenticated first administrator; no secret is sent through the browser. */
export const createOrganization = mutation({
  args: { name: v.string(), slug: v.string(), displayName: v.string() },
  handler: async (ctx, args) => {
    const identity = await currentIdentity(ctx);
    const email = requireIdentityEmail(identity);
    const existingMember = await ctx.db.query("users").withIndex("by_authSubject", (q) => q.eq("authSubject", identity.subject)).unique();
    if (existingMember) throw new Error("ACCESS_ALREADY_PROVISIONED");
    const name = normalizedOrganizationName(args.name);
    const slug = normalizedOrganizationSlug(args.slug);
    const displayName = normalizedDisplayName(args.displayName);
    if (await ctx.db.query("organizations").withIndex("by_slug", (q) => q.eq("slug", slug)).unique()) throw new Error("ORGANIZATION_SLUG_TAKEN");
    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", { name, slug, createdAt: now });
    const userId = await ctx.db.insert("users", { orgId: organizationId, authSubject: identity.subject, displayName, email, role: "admin", status: "active", createdAt: now });
    await writeAuditEvent(ctx, { orgId: organizationId, actorId: userId, action: "organization.created", entityType: "organization", entityId: organizationId, detailsHash: await auditHash(slug) });
    return { organizationId, userId };
  },
});

/** An administrator creates a short-lived, email-bound role invitation. Delivery is handled by the calling product layer. */
export const createInvitation = mutation({
  args: { email: v.string(), role: invitationRole },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["admin"]);
    assertInvitationRole(args.role);
    const email = normalizedInvitationEmail(args.email);
    const pending = await ctx.db.query("organizationInvitations")
      .withIndex("by_org_email_status", (q) => q.eq("orgId", actor.orgId).eq("email", email).eq("status", "pending"))
      .take(1);
    if (pending.length && pending[0].expiresAt > Date.now()) throw new Error("INVITATION_ALREADY_PENDING");
    const now = Date.now();
    const invitationId = await ctx.db.insert("organizationInvitations", { orgId: actor.orgId, email, role: args.role, invitedBy: actor._id, status: "pending", createdAt: now, expiresAt: now + INVITATION_TTL_MS });
    await writeAuditEvent(ctx, { orgId: actor.orgId, actorId: actor._id, action: "organization.invitation_created", entityType: "organizationInvitation", entityId: invitationId, detailsHash: await auditHash(email) });
    return { invitationId, expiresAt: now + INVITATION_TTL_MS };
  },
});

/** Lists only invitations bound to the caller's verified WorkOS email address. */
export const listMyInvitations = query({
  args: {},
  handler: async (ctx) => {
    const email = requireIdentityEmail(await currentIdentity(ctx));
    const pending = await ctx.db.query("organizationInvitations").withIndex("by_email_status", (q) => q.eq("email", email).eq("status", "pending")).take(100);
    const now = Date.now();
    const active = pending.filter((invitation) => invitation.expiresAt > now);
    return await Promise.all(active.map(async (invitation) => {
      const organization = await ctx.db.get(invitation.orgId);
      return organization ? { invitationId: invitation._id, organizationName: organization.name, role: invitation.role, expiresAt: invitation.expiresAt } : null;
    })).then((items) => items.filter((item): item is NonNullable<typeof item> => item !== null));
  },
});

/** Accepts one email-bound invitation and makes the authenticated subject an active member exactly once. */
export const claimInvitation = mutation({
  args: { invitationId: v.id("organizationInvitations"), displayName: v.string() },
  handler: async (ctx, args) => {
    const identity = await currentIdentity(ctx);
    const email = requireIdentityEmail(identity);
    if (await ctx.db.query("users").withIndex("by_authSubject", (q) => q.eq("authSubject", identity.subject)).unique()) throw new Error("ACCESS_ALREADY_PROVISIONED");
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.status !== "pending" || invitation.email !== email || invitation.expiresAt <= Date.now()) throw new Error("INVITATION_NOT_CLAIMABLE");
    const organization = await ctx.db.get(invitation.orgId);
    if (!organization) throw new Error("NOT_FOUND");
    const displayName = normalizedDisplayName(args.displayName);
    const now = Date.now();
    const userId = await ctx.db.insert("users", { orgId: invitation.orgId, authSubject: identity.subject, displayName, email, role: invitation.role, status: "active", createdAt: now });
    await ctx.db.patch(invitation._id, { status: "accepted", acceptedAt: now, acceptedUserId: userId });
    await writeAuditEvent(ctx, { orgId: invitation.orgId, actorId: userId, action: "organization.invitation_claimed", entityType: "organizationInvitation", entityId: invitation._id, detailsHash: await auditHash(invitation.email) });
    return { organizationId: organization._id, userId, role: invitation.role };
  },
});
