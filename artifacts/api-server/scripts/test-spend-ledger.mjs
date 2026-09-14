/**
 * The ledger's arithmetic and attribution, without a database.
 *
 * What it must get right: never invent a tenant from junk metadata, never
 * lose a row because the tenant is unknown, and measure the day the same way
 * the budget does — in UTC, because the loop runs on a UTC cron and a
 * local-midnight boundary would give some projects two budgets on one day.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const s = await loadHermetic("./scripts/spend-ledger-test-entry.ts", "/tmp/jyra-spend-ledger.cjs");

const ORG = "47e5f95e-d448-4fcd-ba8a-3faa62947d02";
const PROJECT = "df9ff273-6829-437e-b66d-b4c96145863b";

// 1. The tenant comes out of the metadata the router already carries, and
//    only when it is actually an id. A provider that echoes a query string
//    back as "projectId" must not create a row against a made-up tenant.
{
  assert.deepEqual(s.tenantFromMetadata({ organizationId: ORG, projectId: PROJECT, intelligenceVersion: "JYRA_INTELLIGENCE_V2" }),
    { organizationId: ORG, projectId: PROJECT, companyId: null, projectCompanyId: null });
  assert.deepEqual(s.tenantFromMetadata({ organizationId: "not-a-uuid", projectId: 42 }),
    { organizationId: null, projectId: null, companyId: null, projectCompanyId: null });
  assert.deepEqual(s.tenantFromMetadata(null),
    { organizationId: null, projectId: null, companyId: null, projectCompanyId: null },
    "an unattributed cost is still a cost — the row is written either way");
  assert.deepEqual(s.tenantFromMetadata({}).organizationId, null);
}

// 2. The day is UTC, because the scheduler is. A local boundary would hand
//    some projects two daily budgets and others none.
{
  assert.equal(s.utcDayStart(new Date("2026-09-14T23:59:59.999Z")).toISOString(), "2026-09-14T00:00:00.000Z");
  assert.equal(s.utcDayStart(new Date("2026-09-15T00:00:00.000Z")).toISOString(), "2026-09-15T00:00:00.000Z");
  // 04:30 IST on the 15th is still the 14th in UTC, and the budget agrees.
  assert.equal(s.utcDayStart(new Date("2026-09-14T23:00:00.000Z")).toISOString(), "2026-09-14T00:00:00.000Z");
  assert.equal(s.utcMonthStart(new Date("2026-09-14T12:00:00.000Z")).toISOString(), "2026-09-01T00:00:00.000Z");
}

// 3. The ceiling now counts money that bought nothing. This is the whole
//    point: a cycle that paid for research and then failed used to leave no
//    trace, so the next one was waved through on a budget already spent.
{
  const spentOnAFailedRun = { spentTodayUsd: 0.97, recentCycleCosts: [0.05] };
  const stopped = s.budgetAllowsCycle({ spend: spentOnAFailedRun, dailyBudgetUsd: 1, fallbackCycleCostUsd: 0.05 });
  assert.equal(stopped.allowed, false, "spend from a failed cycle still closes the gate");
  assert.match(stopped.reason, /daily budget/);

  const fresh = s.budgetAllowsCycle({ spend: { spentTodayUsd: 0, recentCycleCosts: [0.013, 0.014] }, dailyBudgetUsd: 1, fallbackCycleCostUsd: 0.05 });
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.estimateUsd, 0.05, "the fallback floors an estimate drawn from unusually cheap cycles");
}

console.log("PASS spend-ledger");
