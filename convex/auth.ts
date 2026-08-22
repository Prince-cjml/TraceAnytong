import type { MutationCtx, QueryCtx } from "./_generated/server";

export type Role = "viewer" | "issuer" | "investigator" | "admin";
type AuthCtx = QueryCtx | MutationCtx;
type UserRecord = { _id: any; orgId: any; role: Role; status: "active" | "disabled" };

export async function currentUser(ctx: AuthCtx): Promise<UserRecord> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("UNAUTHENTICATED");
  // Auth subject is only used to resolve access server-side; it is never embedded.
  const user = await ctx.db.query("users").withIndex("by_authSubject", (q) => q.eq("authSubject", identity.subject)).unique();
  if (!user || user.status !== "active") throw new Error("FORBIDDEN");
  return user as UserRecord;
}

export async function requireRole(ctx: AuthCtx, allowed: readonly Role[]): Promise<UserRecord> {
  const user = await currentUser(ctx);
  if (!allowed.includes(user.role)) throw new Error("FORBIDDEN");
  return user;
}

export function sameOrganization(resourceOrgId: any, user: UserRecord): void {
  if (resourceOrgId !== user.orgId) throw new Error("FORBIDDEN");
}

export function randomTraceHandle(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
