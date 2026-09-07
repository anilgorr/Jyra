import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

// Deterministic guard tests: only pure helpers are imported; no database,
// provider, or network access. Dummy env keeps module initialisation inert.
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:1";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
delete process.env.JYRA_ALLOWED_HOSTS;
delete process.env.REPLIT_DOMAINS;
delete process.env.REPLIT_DEV_DOMAIN;
delete process.env.JYRA_AUTH_MODE;
delete process.env.JYRA_LOCAL_USER_ID;
delete process.env.JYRA_INTERNAL_ADMIN_USER_IDS;

const output = "/tmp/jyra-security-guards-test.cjs";
await build({ entryPoints: ["./scripts/security-guards-test-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const m = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

// L1 — internal admin ignores session-claim style metadata
assert.equal(m.isInternalAdmin("user_a", undefined, "user_a,user_b"), true);
assert.equal(m.isInternalAdmin("user_c", undefined, "user_a,user_b"), false);
assert.equal(m.isInternalAdmin("user_c", { publicMetadata: { internalAdmin: true } }, ""), true);
assert.equal(m.isInternalAdmin("user_c", { metadata: { internalAdmin: true } }, ""), false);
assert.equal(m.isInternalAdmin("user_c", { publicMetadata: { internalAdmin: "true" } }, ""), false);

// A1 — pluggable auth mode: clerk by default, local only outside production
assert.equal(m.resolveAuthMode({}), "clerk");
assert.equal(m.resolveAuthMode({ JYRA_AUTH_MODE: "" }), "clerk");
assert.equal(m.resolveAuthMode({ JYRA_AUTH_MODE: "clerk" }), "clerk");
assert.equal(m.resolveAuthMode({ JYRA_AUTH_MODE: "local" }), "local");
assert.equal(m.resolveAuthMode({ JYRA_AUTH_MODE: " Local " }), "local");
assert.throws(() => m.resolveAuthMode({ JYRA_AUTH_MODE: "none" }), /not a valid auth mode/);
assert.equal(m.assertAuthModeAllowed({}), "clerk");
assert.equal(m.assertAuthModeAllowed({ NODE_ENV: "production" }), "clerk");
assert.equal(m.assertAuthModeAllowed({ NODE_ENV: "development", JYRA_AUTH_MODE: "local" }), "local");
assert.equal(m.assertAuthModeAllowed({ NODE_ENV: "test", JYRA_AUTH_MODE: "local" }), "local");
assert.throws(() => m.assertAuthModeAllowed({ NODE_ENV: "production", JYRA_AUTH_MODE: "local" }), /JYRA_AUTH_MODE=local is forbidden in production/);
assert.throws(() => m.assertAuthModeAllowed({ REPLIT_DEPLOYMENT: "1", JYRA_AUTH_MODE: "local" }), /forbidden in production/);
assert.throws(() => m.assertAuthModeAllowed({ NODE_ENV: "production", REPLIT_DEPLOYMENT: "1", JYRA_AUTH_MODE: "local" }), /forbidden in production/);
assert.equal(m.isLocalAuthMode({}), false);
assert.equal(m.isLocalAuthMode({ JYRA_AUTH_MODE: "local" }), true);
assert.equal(m.DEFAULT_LOCAL_USER_ID, "local-dev-user");
assert.equal(m.LOCAL_USER_ID, "local-dev-user");
assert.equal(m.localUserId({}), "local-dev-user");
assert.equal(m.localUserId({ JYRA_LOCAL_USER_ID: " dev_42 " }), "dev_42");

// A1 — requireAuth: local mode yields LOCAL_USER_ID; clerk mode still demands Clerk
{
  const fakeRes = () => {
    const res = { locals: {}, statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
  };
  const withAuthMode = (mode, fn) => {
    const previous = process.env.JYRA_AUTH_MODE;
    if (mode === undefined) delete process.env.JYRA_AUTH_MODE; else process.env.JYRA_AUTH_MODE = mode;
    try { return fn(); } finally {
      if (previous === undefined) delete process.env.JYRA_AUTH_MODE; else process.env.JYRA_AUTH_MODE = previous;
    }
  };
  const bareReq = { headers: {}, method: "GET", url: "/api/organizations" };

  await withAuthMode("local", async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "guard tests run outside production");
    assert.equal(m.verifiedUserId(bareReq), "local-dev-user");
    const res = fakeRes();
    let nextCalled = false;
    m.requireAuth(bareReq, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, "local mode: requireAuth passes without Clerk");
    assert.equal(res.locals.userId, "local-dev-user");
    assert.equal(res.statusCode, 200);

    const adminRes = fakeRes();
    let adminNext = false;
    await m.requireInternalAdmin(bareReq, adminRes, () => { adminNext = true; });
    assert.equal(adminNext, true, "local mode: developer is internal admin without contacting Clerk");
    assert.equal(adminRes.locals.userId, "local-dev-user");
  });

  withAuthMode(undefined, () => {
    // Clerk mode is unchanged: without clerkMiddleware there is no auth object and
    // Clerk's own guard fires. The local identity is never substituted.
    assert.throws(() => m.verifiedUserId(bareReq), /clerkMiddleware/);
    assert.throws(() => m.requireAuth(bareReq, fakeRes(), () => {}), /clerkMiddleware/);
  });
  withAuthMode("clerk", () => {
    assert.throws(() => m.verifiedUserId(bareReq), /clerkMiddleware/);
  });
}

// M5 — host allowlist
assert.deepEqual(m.allowedHostsFromEnv({}), []);
assert.deepEqual(
  m.allowedHostsFromEnv({ JYRA_ALLOWED_HOSTS: "App.Example.com, https://api.example.com/x", REPLIT_DOMAINS: "foo.replit.app" }),
  ["app.example.com", "api.example.com", "foo.replit.app"],
);
assert.equal(m.isAllowedHost("evil.com", []), true, "empty allowlist accepts any host (dev)");
assert.equal(m.isAllowedHost("evil.com", ["app.example.com"]), false);
assert.equal(m.isAllowedHost("app.example.com:443", ["app.example.com"]), true);
assert.equal(m.isAllowedHost("x.example.com", ["*.example.com"]), true);
assert.equal(m.isAllowedHost("example.com", ["*.example.com"]), false);
assert.equal(m.isAllowedHost(undefined, ["app.example.com"]), false);
const allowed = ["app.example.com"];
assert.equal(m.getClerkProxyHost({ headers: { "x-forwarded-host": "evil.com", host: "app.example.com" } }, allowed), "app.example.com");
assert.equal(m.getClerkProxyHost({ headers: { "x-forwarded-host": "evil.com, app.example.com", host: "app.example.com" } }, allowed), "app.example.com");
assert.equal(m.getClerkProxyHost({ headers: { "x-forwarded-host": "app.example.com", host: "internal" } }, allowed), "app.example.com");
assert.equal(m.getClerkProxyHost({ headers: { host: "evil.com" } }, allowed), undefined);
assert.equal(m.getClerkProxyHost({ headers: { "x-forwarded-host": "spoofed.com", host: "real.com" } }, []), "spoofed.com", "no allowlist keeps legacy behaviour");

// C2 — pk_test_ is rejected in production only
assert.doesNotThrow(() => m.assertProductionClerkKey({ NODE_ENV: "development", CLERK_PUBLISHABLE_KEY: "pk_test_abc" }));
assert.doesNotThrow(() => m.assertProductionClerkKey({ NODE_ENV: "production", CLERK_PUBLISHABLE_KEY: "pk_live_abc" }));
assert.doesNotThrow(() => m.assertProductionClerkKey({ NODE_ENV: "production" }));
assert.throws(() => m.assertProductionClerkKey({ NODE_ENV: "production", CLERK_PUBLISHABLE_KEY: "pk_test_abc" }), /pk_test_/);
assert.throws(() => m.assertProductionClerkKey({ REPLIT_DEPLOYMENT: "1", CLERK_PUBLISHABLE_KEY: "pk_test_abc" }), /pk_test_/);
assert.equal(m.isProductionRuntime({ NODE_ENV: "test" }), false);
assert.equal(m.positiveIntEnv("X", 7, { X: "0" }), 7);
assert.equal(m.positiveIntEnv("X", 7, { X: "12" }), 12);
assert.equal(m.positiveIntEnv("X", 7, { X: "1.5" }), 7);

// C5 — paid route classification
const P = "11111111-1111-4111-8111-111111111111";
assert.equal(m.isPaidRoute("POST", `/projects/${P}/companies/${P}/people/${P}/enrich-contact`), true);
assert.equal(m.isPaidRoute("POST", `/projects/${P}/opportunity-packs/propose`), true);
assert.equal(m.isPaidRoute("POST", `/projects/${P}/business-twin/versions`), true);
assert.equal(m.isPaidRoute("POST", `/projects/${P}/business-twin/regenerate`), true);
assert.equal(m.isPaidRoute("POST", `/projects/${P}/companies/${P}/research`), true);
assert.equal(m.isPaidRoute("POST", `/projects/${P}/data-import/commit?x=1`), true);
assert.equal(m.isPaidRoute("GET", `/projects/${P}/business-twin/versions`), false);
assert.equal(m.isPaidRoute("GET", `/projects/${P}/companies/${P}/evidence`), false);
assert.equal(m.isPaidRoute("POST", `/projects/${P}/companies/${P}/evidence`), false);

// C5 — contact enrichment eligibility and idempotency
assert.equal(m.canEnrichContact("LOW", false), false);
assert.equal(m.canEnrichContact("HIGH", false), true);
assert.equal(m.canEnrichContact("LOW", true), true);
const day1 = new Date("2026-09-03T10:00:00Z"), day1Later = new Date("2026-09-03T23:59:00Z"), day2 = new Date("2026-09-04T00:00:01Z");
const keyInput = { projectId: "p", projectCompanyId: "pc", personId: "person", capability: "EMAIL_LOOKUP" };
assert.equal(m.contactEnrichmentAttemptKey({ ...keyInput, now: day1 }), m.contactEnrichmentAttemptKey({ ...keyInput, now: day1Later }));
assert.notEqual(m.contactEnrichmentAttemptKey({ ...keyInput, now: day1 }), m.contactEnrichmentAttemptKey({ ...keyInput, now: day2 }));
assert.notEqual(m.contactEnrichmentAttemptKey({ ...keyInput, now: day1 }), m.contactEnrichmentAttemptKey({ ...keyInput, capability: "PHONE_LOOKUP", now: day1 }));

// C6 — budgets fail closed
assert.deepEqual(m.defaultResearchBudgetLimits({}), { dailyBudget: 25, monthlyBudget: 250 });
assert.deepEqual(
  m.defaultResearchBudgetLimits({ JYRA_DEFAULT_DAILY_RESEARCH_BUDGET_CENTS: "500", JYRA_DEFAULT_MONTHLY_RESEARCH_BUDGET_CENTS: "9000" }),
  { dailyBudget: 5, monthlyBudget: 90 },
);
assert.deepEqual(m.defaultResearchBudgetLimits({ JYRA_DEFAULT_DAILY_RESEARCH_BUDGET_CENTS: "-1" }), { dailyBudget: 25, monthlyBudget: 250 });
assert.deepEqual(m.effectiveResearchBudgetLimits(null, {}), { dailyBudget: 25, monthlyBudget: 250 });
assert.deepEqual(m.effectiveResearchBudgetLimits({ dailyBudget: null, monthlyBudget: 40 }, {}), { dailyBudget: 25, monthlyBudget: 40 });
assert.deepEqual(m.effectiveResearchBudgetLimits({ dailyBudget: 3, monthlyBudget: 40 }, {}), { dailyBudget: 3, monthlyBudget: 40 });
{
  const noRow = m.evaluateResearchBudget({ budget: null, daySpend: 24, monthSpend: 0, estimatedCost: 2, env: {} });
  assert.equal(noRow.allowed, false);
  assert.match(noRow.reason, /Daily research budget reached/);
  const monthly = m.evaluateResearchBudget({ budget: { dailyBudget: 1000, monthlyBudget: null }, daySpend: 0, monthSpend: 249, estimatedCost: 2, env: {} });
  assert.equal(monthly.allowed, false);
  assert.match(monthly.reason, /Monthly research budget reached/);
  const ok = m.evaluateResearchBudget({ budget: null, daySpend: 1, monthSpend: 1, estimatedCost: 2, env: {} });
  assert.equal(ok.allowed, true);
  assert.equal(ok.reason, null);
  const explicit = m.evaluateResearchBudget({ budget: { dailyBudget: 2, monthlyBudget: 10 }, daySpend: 1, monthSpend: 1, estimatedCost: 2, env: {} });
  assert.equal(explicit.allowed, false);
}
{
  const limits = m.maximumResearchBudgetLimits({});
  assert.deepEqual(limits, { dailyBudget: 1000, monthlyBudget: 10000 });
  assert.equal(m.validateResearchBudgetInput({ dailyBudget: null, monthlyBudget: 10 }, limits).ok, false);
  assert.equal(m.validateResearchBudgetInput({ dailyBudget: 10, monthlyBudget: null }, limits).ok, false);
  assert.equal(m.validateResearchBudgetInput({ dailyBudget: 0, monthlyBudget: 10 }, limits).ok, false);
  assert.equal(m.validateResearchBudgetInput({ dailyBudget: 1.5, monthlyBudget: 10 }, limits).ok, false);
  assert.equal(m.validateResearchBudgetInput({ dailyBudget: 1001, monthlyBudget: 5000 }, limits).ok, false);
  assert.equal(m.validateResearchBudgetInput({ dailyBudget: 10, monthlyBudget: 10001 }, limits).ok, false);
  assert.equal(m.validateResearchBudgetInput({ dailyBudget: 50, monthlyBudget: 10 }, limits).ok, false);
  assert.deepEqual(m.validateResearchBudgetInput({ dailyBudget: 10, monthlyBudget: 100 }, limits), { ok: true, dailyBudget: 10, monthlyBudget: 100 });
}

// C8 — role gate
assert.equal(m.hasOrgRole("owner"), true);
assert.equal(m.hasOrgRole("admin"), true);
assert.equal(m.hasOrgRole("member"), false);
assert.equal(m.hasOrgRole(null), false);
assert.equal(m.hasOrgRole("OWNER"), false);

// C1 — tenant visibility of canonical-company evidence
const ORG_A = "org-a", ORG_B = "org-b";
const manualReview = { entityReason: m.MANUAL_EVIDENCE_ENTITY_REASON };
const crawlReview = { entityReason: "The source came from the provider capability selected for this canonical company." };
assert.equal(m.isEvidenceVisibleToOrganization({ createdByOrganizationId: ORG_A, provider: "manual" }, manualReview, ORG_A), true, "own manual evidence");
assert.equal(m.isEvidenceVisibleToOrganization({ createdByOrganizationId: ORG_A, provider: "manual" }, manualReview, ORG_B), false, "other org manual evidence hidden");
assert.equal(m.isEvidenceVisibleToOrganization({ createdByOrganizationId: ORG_A, provider: "Manual " }, null, ORG_B), false, "provider case/space insensitive");
assert.equal(m.isEvidenceVisibleToOrganization({ createdByOrganizationId: ORG_A, provider: "tavily" }, manualReview, ORG_B), false, "manual attribution marker wins even with a provider name");
assert.equal(m.isEvidenceVisibleToOrganization({ createdByOrganizationId: ORG_A, provider: "tavily" }, crawlReview, ORG_B), true, "crawl-derived evidence is shared");
assert.equal(m.isEvidenceVisibleToOrganization({ createdByOrganizationId: ORG_A, provider: "tavily" }, null, ORG_B), true, "crawl-derived without review is shared");
assert.equal(m.isEvidenceVisibleToOrganization({ createdByOrganizationId: null, provider: "manual" }, null, ORG_B), true, "legacy rows without creator stay visible");

// L2 — outcomes CSV cap
assert.equal(m.OUTCOMES_CSV_MAX_BYTES, 2 * 1024 * 1024);
assert.equal(m.OUTCOMES_CSV_MAX_LINES, 20_000);
assert.deepEqual(m.parseOutcomesCsv("domain,outcome,occurred_at\nexample.com,MEETING,2026-01-02"), [{ domain: "example.com", outcome: "MEETING", occurredAt: "2026-01-02T00:00:00.000Z" }]);
assert.throws(() => m.parseOutcomesCsv(`domain,outcome,occurred_at\n${"x".repeat(2 * 1024 * 1024)}`), /CSV_EXCEEDS_2097152_BYTES/);
assert.throws(() => m.parseOutcomesCsv(["domain,outcome,occurred_at", ...Array.from({ length: 20_001 }, (_, i) => `d${i}.com,OTHER,2026-01-01`)].join("\n")), /CSV_EXCEEDS_20000_ROWS/);
assert.equal(m.parseOutcomesCsv(["domain,outcome,occurred_at", ...Array.from({ length: 20_000 }, (_, i) => `d${i}.com,OTHER,2026-01-01`)].join("\n")).length, 20_000);

console.log("security guard tests passed");
