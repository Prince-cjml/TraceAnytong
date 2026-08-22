import type { MutationCtx } from "./_generated/server";

export async function writeAuditEvent(
  ctx: MutationCtx,
  event: { orgId: any; actorId?: any; action: string; entityType: string; entityId: string; detailsHash: string },
): Promise<void> {
  await ctx.db.insert("auditEvents", { ...event, time: Date.now() });
}
