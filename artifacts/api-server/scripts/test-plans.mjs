/**
 * The plan tiers and the message a customer sees when they hit a pool.
 *
 * The watch pool is enforced because
 * the promise depends on it: ten intent accounts a month come from watching
 * about 125 companies. Letting a Starter watch a thousand would not deliver a
 * hundred accounts — it would cost eight times as much to run and still
 * deliver ten.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const p = await loadHermetic("./scripts/plans-test-entry.ts", "/tmp/jyra-plans.cjs");

// 1. The tiers are the ones agreed on 14 Sep, and they are internally coherent:
//    every step up buys more of everything, and the pool always dwarfs the
//    promise because most watched companies never show intent in a given month.
{
  const codes = p.PLAN_TIERS.map((tier) => tier.code);
  assert.deepEqual(codes, ["starter", "growth", "scale", "custom"]);
  const starter = p.PLAN_TIERS[0];
  assert.equal(starter.intentAccountsPerMonth, 10);
  assert.equal(starter.watchPoolSize, 125);
  assert.equal(starter.priceInr, 4999);
  assert.equal(starter.priceUsd, 99);
  for (const [index, tier] of p.PLAN_TIERS.entries()) {
    assert.ok(tier.watchPoolSize > tier.intentAccountsPerMonth * 5,
      `${tier.code}: the pool must be much larger than the promise`);
    if (index === 0) continue;
    const below = p.PLAN_TIERS[index - 1];
    assert.ok(tier.intentAccountsPerMonth > below.intentAccountsPerMonth, `${tier.code} promises more`);
    assert.ok(tier.watchPoolSize > below.watchPoolSize, `${tier.code} watches more`);
    assert.ok(tier.senderSeats >= below.senderSeats, `${tier.code} sends from at least as many accounts`);
    assert.ok(tier.priceInr > below.priceInr && tier.priceUsd > below.priceUsd, `${tier.code} costs more`);
    assert.ok(tier.sortOrder > below.sortOrder);
  }
}

// 2. The fallback plan is the small one. An organisation nobody has priced
//    should meet a limit early and cheaply, not run up a bill no one agreed to.
{
  assert.equal(p.defaultPlanCode({}), "starter");
  assert.equal(p.defaultPlanCode({ JYRA_DEFAULT_PLAN: "scale" }), "scale");
  assert.equal(p.defaultPlanCode({ JYRA_DEFAULT_PLAN: "enterprise-unlimited" }), "starter",
    "an unknown plan name falls back rather than removing the cap");
  assert.equal(p.defaultPlanCode({ JYRA_DEFAULT_PLAN: "  GROWTH  " }), "growth");
}

// 3. The refusal says what plan, what the limit is, how much is used, and what
//    to do about it. "Plan limit reached" on its own is not an answer.
{
  const plan = { code: "starter", name: "Starter", watchPoolSize: 125, intentAccountsPerMonth: 10, senderSeats: 1, priceInr: 4999, priceUsd: 99, assigned: true, overridden: [] };
  const error = new p.PlanLimitError("watchPool", plan, 120, 10);
  assert.equal(error.code, "PLAN_LIMIT_REACHED");
  assert.equal(error.name, "PlanLimitError");
  assert.match(error.message, /Starter/);
  assert.match(error.message, /125 companies/);
  assert.match(error.message, /120 are in the pool/);
  assert.match(error.message, /Adding 10 more/);
  assert.match(error.message, /Archive companies you are done with, or move to a larger plan/,
    "a limit the customer cannot act on is a dead end");
  assert.ok(error instanceof Error, "so route handlers can catch it normally");
}

// 4. Two pools, and the screening one is eight times the watch pool.
//
//    Capping the upload at the watch pool would have made a bought list
//    unusable: 4,676 domains in the first real export, of which the customer
//    cannot know which matter — that is what they are paying JYRA to work out.
//    So a Starter holds 1,000 and watches the best 125 of them.
{
  assert.equal(p.SCREENING_POOL_MULTIPLE, 8);
  assert.equal(p.screeningPoolSize({ watchPoolSize: 125 }), 1_000);
  for (const tier of p.PLAN_TIERS) {
    assert.equal(p.screeningPoolSize(tier), tier.watchPoolSize * 8);
    assert.ok(
      p.screeningPoolSize(tier) > tier.watchPoolSize,
      "holding must always be roomier than watching, or screening is pointless",
    );
  }
}

// 5. The screening refusal is a different sentence, because it has a different
//    remedy. Telling someone their watch pool is full when the upload was
//    refused sends them to archive the wrong companies.
{
  const plan = { code: "starter", name: "Starter", watchPoolSize: 125, intentAccountsPerMonth: 10, senderSeats: 1, priceInr: 4999, priceUsd: 99, assigned: true, overridden: [] };
  const error = new p.PlanLimitError("screeningPool", plan, 950, 200);
  assert.equal(error.code, "PLAN_LIMIT_REACHED");
  assert.match(error.message, /1000 companies for screening/);
  assert.match(error.message, /950 are held/);
  assert.match(error.message, /Uploading 200 more/);
  assert.ok(!/watches up to/.test(error.message), "the watch pool is not what was hit");
}

// 6. The status sets are positive lists, and screening is in exactly one of
//    them.
//
//    Every reader of project_companies.status used `<> 'archived'`. That was
//    correct while archived was the only exclusion and silently wrong the
//    moment a second one existed: adding screening would have put every
//    uploaded company back into the watch loop, the plan's pool count, the
//    customer's market view and the opportunity feed, by changing nothing.
{
  assert.deepEqual([...p.WATCHED_PROJECT_COMPANY_STATUSES], ["candidate", "active"]);
  assert.ok(!p.WATCHED_PROJECT_COMPANY_STATUSES.includes("screening"),
    "a screened company is stored, not watched — it must cost nothing");
  assert.ok(!p.WATCHED_PROJECT_COMPANY_STATUSES.includes("archived"));

  // Re-evaluating stored facts is free, and it is how a screened company earns
  // the ranking that decides whether it is worth promoting.
  assert.ok(p.LIVE_PROJECT_COMPANY_STATUSES.includes("screening"));
  assert.ok(!p.LIVE_PROJECT_COMPANY_STATUSES.includes("archived"));

  // Every status the database knows is accounted for by one of the two lists
  // or by being archived. A state that belongs to neither is a state some
  // query silently forgets.
  const known = new Set([...p.LIVE_PROJECT_COMPANY_STATUSES, "archived"]);
  for (const value of p.projectCompanyStatusEnum.enumValues) {
    assert.ok(known.has(value), `status ${value} belongs to no list`);
  }
}

console.log("PASS plans");
