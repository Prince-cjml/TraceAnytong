import assert from "node:assert/strict";
import test from "node:test";
import { activeTraceCaseCount, boundedDashboardCount, boundedJobStateCounts, DASHBOARD_COUNT_LIMIT } from "./dashboardRules.ts";

test("dashboard summaries remain bounded and never treat terminal cases as open", () => {
  assert.deepEqual(boundedDashboardCount(DASHBOARD_COUNT_LIMIT), { value: 100, capped: false });
  assert.deepEqual(boundedDashboardCount(DASHBOARD_COUNT_LIMIT + 1), { value: 100, capped: true });
  assert.equal(activeTraceCaseCount(["queued", "processing", "complete", "failed"]), 2);
});

test("administrator job summaries disclose states but no individual job records", () => {
  const counts = boundedJobStateCounts({ queued: Array(2), leased: [], running: Array(101), retryable: Array(1), failed: [] });
  assert.deepEqual(counts.running, { value: 100, capped: true });
  assert.deepEqual(counts.queued, { value: 2, capped: false });
});
