export const LEASE_DURATION_MS = 10 * 60 * 1000;
const retryDelays = [0, 30_000, 120_000, 600_000] as const;

export function retryAt(now: number, attempts: number): number {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("INVALID_ATTEMPT");
  return now + retryDelays[Math.min(attempts - 1, retryDelays.length - 1)];
}

export function leaseIsActive(leaseOwner: string | undefined, leaseExpiresAt: number | undefined, workerId: string, now: number): boolean {
  return leaseOwner === workerId && leaseExpiresAt !== undefined && leaseExpiresAt > now;
}

export function completionDisposition(state: string, previousOutputStorageId: string | undefined, nextOutputStorageId: string): "complete" | "idempotent" | "conflict" {
  if (state !== "succeeded") return "complete";
  return previousOutputStorageId === nextOutputStorageId ? "idempotent" : "conflict";
}
