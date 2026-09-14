/**
 * The plan tiers and the message a customer sees when they hit the pool.
 *
 * The watch pool is the only limit enforced today, and it is enforced because
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

console.log("PASS plans");
