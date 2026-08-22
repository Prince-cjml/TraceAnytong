export const DASHBOARD_COUNT_LIMIT = 100;

export function boundedDashboardCount(rowsSeen: number): { value: number; capped: boolean } {
  return { value: Math.min(rowsSeen, DASHBOARD_COUNT_LIMIT), capped: rowsSeen > DASHBOARD_COUNT_LIMIT };
}

export function activeTraceCaseCount(states: readonly string[]): number {
  return states.filter((state) => state === "queued" || state === "processing").length;
}
