import assert from "node:assert/strict";
import test from "node:test";
import { activeTraceCaseCount, boundedDashboardCount, DASHBOARD_COUNT_LIMIT } from "./dashboardRules.ts";

test("dashboard summaries remain bounded and never treat terminal cases as open", () => {
  assert.deepEqual(boundedDashboardCount(DASHBOARD_COUNT_LIMIT), { value: 100, capped: false });
  assert.deepEqual(boundedDashboardCount(DASHBOARD_COUNT_LIMIT + 1), { value: 100, capped: true });
  assert.equal(activeTraceCaseCount(["queued", "processing", "complete", "failed"]), 2);
});
