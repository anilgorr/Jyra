/**
 * The door, and the one rule about money.
 *
 * Three things are pinned here.
 *
 * 1. Who is an admin. `ADMIN_EMAILS` matches the VERIFIED PRIMARY email from
 *    a server-side Clerk lookup, case-insensitively, and nothing else - not a
 *    secondary address, not a session claim. The founder was locked out of
 *    his own admin panel by a 403 because the only mechanism was a Clerk user
 *    id nobody remembers; the email path fixes that without opening a hole.
 *
 * 2. How an invited email is matched. One normalisation, on write and on
 *    read. `Priya@Acme.co ` and `priya@acme.co` are the same invitation.
 *
 * 3. Customers never see a cost. `PlanUsage` - the customer's plan page - has
 *    no field that carries a currency amount for cost of goods, and the
 *    schema strips one if a route tries to add it. The admin shapes DO carry
 *    it, and that is asserted too, so the test fails loudly if someone
 *    "simplifies" by sharing one shape between the two. This was a deliberate
 *    reversal on 16 Sep 2026 of an earlier choice to show spend; the reasons
 *    are in routes/plan.ts.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
process.env.CLERK_SECRET_KEY ??= "sk_test_unused";

const m = await loadHermetic(
  "./scripts/access-control-test-entry.ts",
  "/tmp/jyra-access-control.cjs",
);

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log(`  ok  ${name}`); };

// ---------------------------------------------------------------- admins

console.log("\naccess control — who is an admin");

check("an email on ADMIN_EMAILS is an admin, case-insensitively", () => {
  assert.equal(m.isInternalAdmin("user_1", { primaryEmail: "Anil@Example.com" }, "", "anil@example.com"), true);
  assert.equal(m.isInternalAdmin("user_1", { primaryEmail: "anil@example.com" }, "", " ANIL@example.com , other@x.io"), true);
});

check("an email not on the list is not an admin", () => {
  assert.equal(m.isInternalAdmin("user_1", { primaryEmail: "someone@else.com" }, "", "anil@example.com"), false);
});

check("no primary email means no email match, whatever the list says", () => {
  assert.equal(m.isInternalAdmin("user_1", { primaryEmail: null }, "", "anil@example.com"), false);
  assert.equal(m.isInternalAdmin("user_1", undefined, "", "anil@example.com"), false);
});

check("an empty ADMIN_EMAILS admits nobody by email", () => {
  assert.equal(m.isInternalAdmin("user_1", { primaryEmail: "" }, "", ""), false);
  assert.equal(m.isInternalAdmin("user_1", { primaryEmail: "anil@example.com" }, "", ""), false);
});

check("the Clerk user-id allowlist still works alongside", () => {
  assert.equal(m.isInternalAdmin("user_abc", undefined, "user_abc,user_def", ""), true);
  assert.equal(m.isInternalAdmin("user_zzz", undefined, "user_abc,user_def", ""), false);
});

check("publicMetadata.internalAdmin still works alongside", () => {
  assert.equal(m.isInternalAdmin("user_1", { publicMetadata: { internalAdmin: true } }, "", ""), true);
  assert.equal(m.isInternalAdmin("user_1", { publicMetadata: { internalAdmin: "true" } }, "", ""), false, "a string is not a flag");
});

// ---------------------------------------------------------------- grants

console.log("\naccess control — matching an invitation");

check("email normalisation is one function, lower-case and trimmed", () => {
  assert.equal(m.normalizeGrantEmail("  Priya@Acme.co "), "priya@acme.co");
  assert.equal(m.normalizeGrantEmail("priya@acme.co"), m.normalizeGrantEmail("PRIYA@ACME.CO"));
});

check("a first-login organisation is named from the domain, never blank", () => {
  assert.equal(m.organizationNameFromEmail("priya@acme.co"), "Acme");
  assert.equal(m.organizationNameFromEmail("x@getvymo.com"), "Getvymo");
  assert.equal(m.organizationNameFromEmail("broken"), "My organisation");
});

// ---------------------------------------------------------------- money

console.log("\naccess control — customers never see a cost");

/** Every key path in a Zod object schema, dotted. */
function keyPaths(schema, prefix = "") {
  const shape = schema?.shape ?? schema?._def?.shape?.();
  if (!shape) {
    const inner = schema?._def?.type ?? schema?.element ?? schema?._def?.innerType;
    return inner ? keyPaths(inner, prefix) : [];
  }
  return Object.entries(shape).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...keyPaths(value, path)];
  });
}

const COST_WORDS = /usd|inr|cost|spend|price|wasted|margin|rupee|dollar/i;
const LIST_PRICE_ALLOWED = new Set(["plan.priceInr", "plan.priceUsd"]);

check("PlanUsage carries no cost-of-goods field", () => {
  const paths = keyPaths(m.GetProjectPlanUsageResponse);
  assert.ok(paths.length > 10, `expected a real shape, got ${paths.length} paths`);
  const offending = paths.filter((p) => COST_WORDS.test(p) && !LIST_PRICE_ALLOWED.has(p));
  assert.deepEqual(offending, [], `customer-facing PlanUsage exposes cost fields: ${offending.join(", ")}`);
  assert.ok(!paths.some((p) => p.startsWith("spend")), "the old `spend` block is back on the customer shape");
});

check("PlanUsage does carry credits, so the customer sees something", () => {
  const paths = keyPaths(m.GetProjectPlanUsageResponse);
  for (const required of ["credits.balance", "credits.monthlyAllowance", "credits.recent"]) {
    assert.ok(paths.includes(required), `missing ${required}`);
  }
});

check("the admin shapes DO carry real cost - the two must not be merged", () => {
  const grant = keyPaths(m.ListAccessGrantsResponseItem);
  assert.ok(grant.includes("spend.monthToDateUsd"), "admin grant row lost its cost figure");
  assert.ok(grant.includes("spend.monthToDateInr"), "admin grant row lost its rupee figure");
  const cost = keyPaths(m.GetAccessGrantCostResponse);
  assert.ok(cost.includes("spend.breakdown"), "admin cost detail lost its breakdown");
});

check("a cost field smuggled onto PlanUsage at runtime never reaches the customer", () => {
  // The generated schema is a plain zod.object, which STRIPS unknown keys
  // rather than rejecting them (orval does not emit .strict() for
  // additionalProperties: false). Stripping is enough for the guarantee: the
  // route parses before it responds, so whatever the route computed, the
  // wire carries only the declared shape. This asserts the strip.
  const minimal = {
    plan: { code: "starter", name: "Starter", intentAccountsPerMonth: 10, watchPoolSize: 125, senderSeats: 1, creditsPerMonth: 5000, priceInr: 4999, priceUsd: 99, assigned: true, overridden: [] },
    watchPool: { used: 0, limit: 125, remaining: 125, thisProject: 0 },
    screeningPool: { used: 0, limit: 1000, remaining: 1000 },
    intentAccounts: { month: "2026-09-01", delivered: 0, promised: 10, remaining: 10, workingList: [] },
    credits: { balance: 5000, monthlyAllowance: 5000, periodStart: "2026-09-01T00:00:00.000Z", recent: [] },
  };
  assert.equal(m.GetProjectPlanUsageResponse.safeParse(minimal).success, true, "the honest shape must parse");
  const smuggled = m.GetProjectPlanUsageResponse.safeParse({ ...minimal, spend: { monthToDateUsd: 1.19 } });
  assert.equal(smuggled.success, true);
  assert.equal("spend" in smuggled.data, false, "a `spend` block reached the wire through the customer shape");
  assert.equal(JSON.stringify(smuggled.data).includes("1.19"), false, "the cost figure survived serialisation");
});


// ------------------------------------------------------- what the app is told

check("/me says whether the person is an internal admin, and will not parse without saying", () => {
  // The app used to learn this by calling an admin endpoint and reading the
  // 403 - a red failed request in every customer's console on every load.
  assert.equal(m.GetCurrentUserResponse.safeParse({ id: "u", organizationCount: 1, isInternalAdmin: false }).success, true);
  assert.equal(m.GetCurrentUserResponse.safeParse({ id: "u", organizationCount: 1 }).success, false, "the flag must be explicit, never assumed");
  assert.equal(m.GetCurrentUserResponse.safeParse({ id: "u", organizationCount: 1, isInternalAdmin: "yes" }).success, false);
});

console.log(`\naccess control: ${checks} checks passed`);
