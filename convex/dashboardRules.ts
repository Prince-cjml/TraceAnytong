export const DASHBOARD_COUNT_LIMIT = 100;
export const ADMIN_JOB_STATES = ["queued", "leased", "running", "retryable", "failed"] as const;
export type AdminJobState = (typeof ADMIN_JOB_STATES)[number];

export function boundedDashboardCount(rowsSeen: number): { value: number; capped: boolean } {
  return { value: Math.min(rowsSeen, DASHBOARD_COUNT_LIMIT), capped: rowsSeen > DASHBOARD_COUNT_LIMIT };
}

export function activeTraceCaseCount(states: readonly string[]): number {
  return states.filter((state) => state === "queued" || state === "processing").length;
}

export function boundedJobStateCounts(rowsByState: Record<AdminJobState, readonly unknown[]>): Record<AdminJobState, { value: number; capped: boolean }> {
  return Object.fromEntries(ADMIN_JOB_STATES.map((state) => [state, boundedDashboardCount(rowsByState[state].length)])) as Record<AdminJobState, { value: number; capped: boolean }>;
}
