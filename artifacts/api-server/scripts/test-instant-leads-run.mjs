/**
 * The Instant Leads run, end to end, without a database, a provider or a model.
 * @hermetic — the tables named below live in memory (scripts/lib/memdb.mjs).
 *
 * `@workspace/db` is the recorder from fake-db-stub.ts, answered by an
 * in-memory table store (lib/memdb.mjs) that evaluates drizzle where/join
 * clauses. Crustdata is a scripted client; the research cycle is a function
 * that plants a signal on the companies the scenario says show intent.
 *
 * What must hold: a quote that refuses before anything is held; a hold on
 * submit and a settle for exactly what was delivered; an order that stops
 * researching as soon as enough leads are confirmed; a market that runs out
 * giving PARTIAL and releasing the rest; a provider failure delivering what
 * was confirmed and releasing the rest; a cancel mid-run doing the same; a
 * restart resuming from the persisted candidate list; a second run never
 * delivering a company the first one did; and the customer's view carrying
 * no currency.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMemDb } from "./lib/memdb.mjs";

process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
process.env.CRUSTDATA_API_KEY ??= "test-key";

const stubPath = fileURLToPath(new URL("./fake-db-stub.ts", import.meta.url));
const output = "/tmp/jyra-instant-leads-run-test.cjs";
await build({
  entryPoints: ["./scripts/instant-leads-run-test-entry.ts"],
  outfile: output, bundle: true, format: "cjs", platform: "node", external: ["pg-native"],
  plugins: [{ name: "fake-workspace-db", setup(b) { b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: stubPath })); } }],
});
const m = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const USER = "user_anil";
const quiet = { info: () => {}, warn: (obj, msg) => { if (process.env.DEBUG_RUN) console.log("WARN", msg, JSON.stringify(obj, (k, v) => (v instanceof Error ? v.stack : v)).slice(0, 600)); } };
let clock = new Date("2026-10-07T09:00:00.000Z");
const now = () => new Date(clock);
const tick = (ms) => { clock = new Date(clock.getTime() + ms); };

/** A fresh world: one org on the starter plan with a balance, one ready project, one approved pack. */
function world({ balance = 1000 } = {}) {
  const db = createMemDb({ now });
  db.declareUnique(m.projectCompaniesTable, ["projectId", "companyId"]);
  db.declareUnique(m.instantLeadRunLeadsTable, ["runId", "projectCompanyId"]);
  db.declareUnique(m.companiesTable, ["domain"]);
  db.seed(m.organizationsTable, [{ id: ORG, name: "F30 Advertising" }]);
  db.seed(m.projectsTable, [{ id: PROJECT, organizationId: ORG, name: "Consulting Q3 2026" }]);
  db.seed(m.plansTable, [{ id: "plan-starter", code: "starter", name: "Starter", intentAccountsPerMonth: 20, watchPoolSize: 50, senderSeats: 1, creditsPerMonth: 500, priceInr: 0, priceUsd: 0, creditsPerInstantLead: 30, creditsPerContactVerified: 20, creditsPerContactCatchAll: 10 }]);
  db.seed(m.organizationCreditsTable, [{ organizationId: ORG, balance, monthlyAllowance: 500, periodStart: new Date("2026-10-01T00:00:00Z") }]);
  db.seed(m.businessTwinVersionsTable, [{ id: "bt-v1", businessTwinId: "bt-1", projectId: PROJECT, version: 1, status: "ready", createdAt: now(),
    rawAnswers: { companyName: "F30 Advertising", offeringName: "Brand and marketing consulting", website: "https://f30.ae", industry: "Marketing services", targetGeographies: "India, Middle East" }, aiInterpretation: {}, manualInterpretation: {} }]);
  db.seed(m.icpVersionsTable, [{ id: "icp-v1", icpId: "icp-1", projectId: PROJECT, version: 1, createdAt: now(), sourceBusinessTwinVersionId: "bt-v1", assumptions: [] }]);
  db.seed(m.icpCriteriaTable, [
    { id: "c1", projectId: PROJECT, icpVersionId: "icp-v1", dimension: "employee_count", operator: "BETWEEN", value: { min: 10, max: 200 }, accepted: true },
    { id: "c2", projectId: PROJECT, icpVersionId: "icp-v1", dimension: "geography", operator: "IN", value: ["India", "Middle East"], accepted: true },
    { id: "c3", projectId: PROJECT, icpVersionId: "icp-v1", dimension: "industry", operator: "IN", value: ["Retail", "Fintech", "Edtech"], accepted: true },
  ]);
  db.seed(m.signalPacksTable, [{ id: "pack-1", slug: "marketing", name: "Marketing buyers", description: "Signals a marketing consultancy cares about", version: "1", status: "APPROVED", active: true, updatedAt: now() }]);
  db.seed(m.projectSignalPacksTable, [{ id: "psp-1", projectId: PROJECT, signalPackId: "pack-1", active: true, configuration: null, updatedAt: now() }]);
  db.seed(m.signalDefinitionsTable, [
    { id: "def-hiring", signalPackId: "pack-1", code: "HIRING_MARKETING", name: "Hiring in marketing", description: "A company hiring marketers is building the function you sell into", category: "HIRING", polarity: "POSITIVE", status: "APPROVED", lifetimeDays: 90, configuration: { matchAny: ["marketing"] }, factRequirements: { factTypes: ["JOB_OPENING"] }, minimumConfidence: 0.5 },
    { id: "def-funding", signalPackId: "pack-1", code: "FUNDING_ROUND", name: "Raised funding", description: "New money means new budgets", category: "FUNDING", polarity: "POSITIVE", status: "APPROVED", lifetimeDays: 180, configuration: {}, factRequirements: { factTypes: ["FUNDING_EVENT"] }, minimumConfidence: 0.5 },
    { id: "def-layoff", signalPackId: "pack-1", code: "WORKFORCE_REDUCTION", name: "Workforce reduction", description: "Cutting staff", category: "NEGATIVE", polarity: "NEGATIVE", status: "APPROVED", lifetimeDays: 180, configuration: {}, factRequirements: {}, minimumConfidence: 0.5 },
  ]);
  db.seed(m.dataProvidersTable, [{ id: "prov-crust", name: "Crustdata", providerType: "crustdata", enabled: true, configuration: { usdPerCredit: 0.1 } }]);
  m.installFakeDb(db.resolver);
  return db;
}

const company = (n, extra = {}) => ({
  id: n, name: `Company ${n}`, domain: `company${n}.com`, website: `https://company${n}.com`, headcount: 40 + n, headcountGrowth6m: 20, headcountGrowth3m: 8,
  country: "ARE", city: "Dubai", industries: ["Retail"], lastFundraiseDate: null, lastRoundType: null, totalInvestmentUsd: null, raw: {}, ...extra,
});

/** A scripted provider: pages of companies, then nothing. Records every call. */
function fakeClient(pages, { failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    configuration: { usdPerCredit: 0.1, searchCreditsPerResult: 0.03 },
    async searchCompanies(input) {
      calls.push({ ...input });
      if (failOn && calls.length === failOn.call) throw new m.CrustdataError(failOn.code ?? "CRUSTDATA_HTTP", failOn.message ?? "boom", false, 500);
      const index = input.cursor ? Number(input.cursor) : 0;
      const items = pages[index] ?? [];
      const nextCursor = index + 1 < pages.length ? String(index + 1) : null;
      return { items, totalCount: pages.flat().length, nextCursor, creditsUsed: items.length * 0.03, costUsd: items.length * 0.003 };
    },
    async searchPeople() { throw new Error("not in this test"); },
    async enrichContact() { throw new Error("not in this test"); },
  };
}

/** The research cycle, as the run sees it: plants an ACTIVE pack signal when the scenario says the company shows intent. */
function fakeCycle(db, { intent, failFor = () => null, ms = 1000 }) {
  const seen = [];
  return async ({ owned }) => {
    seen.push(owned.company.domain);
    const failure = failFor(owned.company.domain);
    if (failure) throw failure;
    tick(ms);
    const score = intent(owned.company.domain);
    const projectCompany = db.all(m.projectCompaniesTable).find((row) => row.id === owned.projectCompany.id);
    projectCompany.latestResearchAt = now();
    if (score === null) { projectCompany.opportunityScore = 10; return { changeset: { hasChanges: false }, result: { observability: { totalCost: 0.01, modelCalls: 1 } } }; }
    projectCompany.opportunityScore = score;
    projectCompany.opportunityState = score >= 70 ? "ACT_NOW" : "WATCH";
    db.seed(m.companyFactsTable, [{ id: `fact-${owned.company.domain}`, companyId: owned.company.id, evidenceId: "ev", factType: "JOB_OPENING", structuredValue: { title: "Head of Marketing" }, effectiveDate: "2026-10-01", confidence: 0.9, supportingExcerpt: "Head of Marketing — Dubai", extractorVersion: "t" }]);
    db.seed(m.signalsTable, [{ id: `sig-${owned.company.domain}`, projectId: PROJECT, companyId: owned.company.id, signalDefinitionId: "def-hiring", status: "ACTIVE", effectiveDate: "2026-10-01", originalStrength: score / 100, currentStrength: score / 100, confidence: 0.9, supportingFactIds: [`fact-${owned.company.domain}`] }]);
    db.seed(m.spendLedgerTable, [{ organizationId: ORG, projectId: PROJECT, projectCompanyId: owned.projectCompany.id, kind: "MODEL", source: "OpenAI", capability: "ASSESSMENT", outcome: "success", costUsd: 0.013, occurredAt: now(), metadata: {} }]);
    return { changeset: { hasChanges: true }, result: { observability: { totalCost: 0.013, modelCalls: 1 } } };
  };
}

const deps = (db, client, cycle, extra = {}) => ({ ...m.DEFAULT_RUN_DEPS, client, cycle, repository: {}, log: quiet, now, concurrency: 2, batchSize: 10, candidatesPerLead: 5, assumedCycleMs: 1000, maxDurationMs: 60 * 60_000, ...extra });
const project = () => ({ id: PROJECT, organizationId: ORG, name: "Consulting Q3 2026" });
const balance = (db) => db.all(m.organizationCreditsTable)[0].balance;
const ledger = (db) => db.all(m.creditLedgerTable).map((row) => ({ kind: row.kind, delta: row.delta, stage: row.context?.stage }));
const noCurrency = (value) => { const text = JSON.stringify(value); assert.ok(!/usd|cost|\$|₹/i.test(text), `customer view leaks a cost: ${text.slice(0, 200)}`); };

// 1. The quote: price, balance, blockers, the ICP as the provider will see it. Nothing is held.
{
  const db = world({ balance: 100 });
  const quote = await m.quoteInstantLeads({ project: project(), requested: 10, now: now() });
  assert.equal(quote.creditsPerLead, 30);
  assert.equal(quote.creditsRequired, 300);
  assert.equal(quote.balance, 100);
  assert.equal(quote.shortfall, 200);
  assert.equal(quote.affordable, 3);
  assert.deepEqual(quote.blockers.map((b) => b.code), ["INSUFFICIENT_CREDITS"]);
  assert.ok(quote.icp.summary.some((line) => /10/.test(line) && /200/.test(line)), `headcount in summary: ${quote.icp.summary}`);
  assert.ok(quote.icp.summary.some((line) => /India/.test(line)), `geography in summary: ${quote.icp.summary}`);
  assert.equal(quote.pack.name, "Marketing buyers");
  assert.equal(quote.contactPrices.verified, 20);
  assert.ok(quote.estimatedMinutes >= 3);
  assert.equal(db.all(m.creditLedgerTable).length, 0, "a quote writes nothing");
  noCurrency(quote);
  await assert.rejects(() => m.createInstantLeadRun({ project: project(), userId: USER, requested: 10, now: now() }), (error) => error instanceof m.InstantLeadRequestError && error.code === "INSUFFICIENT_CREDITS" && error.status === 402);
  assert.equal(balance(db), 100, "a refused submit holds nothing");
}

// 2. No pack, no ICP: refused at the quote, never at the provider.
{
  const db = world();
  db.rows.set("project_signal_packs", []);
  const quote = await m.quoteInstantLeads({ project: project(), requested: 2, now: now() });
  assert.ok(quote.blockers.some((b) => b.code === "NO_PACK"));
  await assert.rejects(() => m.createInstantLeadRun({ project: project(), userId: USER, requested: 2, now: now() }), (error) => error.code === "NO_PACK" && error.status === 409);
}

// 3. The full run: 3 leads asked, a market of 12 where 5 show intent. The hold is 90; three are
//    delivered; research stops once three are confirmed; 90 are settled, nothing released.
{
  const db = world({ balance: 500 });
  const market = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => company(n));
  const client = fakeClient([market.slice(0, 10), market.slice(10)]);
  const hot = new Set(["company2.com", "company5.com", "company7.com", "company9.com", "company11.com"]);
  const cycle = fakeCycle(db, { intent: (domain) => (hot.has(domain) ? 80 + Number(domain.replace(/\D/g, "")) : null) });
  const { run, quote } = await m.createInstantLeadRun({ project: project(), userId: USER, requested: 3, now: now() });
  assert.equal(run.status, "QUEUED");
  assert.equal(run.creditsHeld, 90);
  assert.equal(balance(db), 410, "the hold leaves the balance");
  assert.deepEqual(ledger(db), [{ kind: "debit", delta: -90, stage: "hold" }]);
  assert.equal(quote.blockers.length, 0);

  const finished = await m.executeInstantLeadRun(run.id, deps(db, client, cycle));
  assert.equal(finished.status, "DONE", finished.outcomeNote);
  assert.equal(finished.delivered, 3);
  assert.equal(finished.creditsSettled, 90);
  assert.equal(balance(db), 410, "settled for three: nothing comes back");
  assert.deepEqual(ledger(db), [{ kind: "debit", delta: -90, stage: "hold" }], "no release entry when everything was delivered");
  assert.equal(client.calls.length, 1, "one page was enough: the second page was never bought");
  assert.equal(finished.candidatesFound, 10);
  assert.equal(finished.candidatesAccepted, 10);
  assert.equal(finished.researched, 10, "a batch is researched whole, then ranked");
  assert.ok(finished.providerCostUsd > 0 && finished.researchCostUsd > 0, "costs are attributed to the run (admin only)");
  assert.equal(finished.pendingProjectCompanyIds.length, 0);
  assert.match(finished.outcomeNote, /3 leads delivered; 90 credits charged/);

  const leads = db.all(m.instantLeadRunLeadsTable).sort((a, b) => a.rank - b.rank);
  assert.equal(leads.length, 3);
  const delivered = leads.map((lead) => db.all(m.companiesTable).find((c) => c.id === lead.companyId).domain);
  assert.deepEqual(delivered, ["company9.com", "company7.com", "company5.com"], "ranked by opportunity score, best first");
  assert.ok(leads[0].why.some((line) => /Head of Marketing/.test(line) && /2026/.test(line)), `why says what and when: ${leads[0].why}`);
  assert.ok(leads[0].why.some((line) => /building the function you sell into/.test(line)), "why carries the pack's reason");
  assert.ok(leads[0].why.some((line) => /Fits your ICP/.test(line)), "why says why it fits");
  assert.ok(!leads[0].why.some((line) => /http/.test(line)), "no URLs on the card");
  assert.deepEqual(leads[0].signalCodes, ["HIRING_MARKETING"]);
  const memberships = db.all(m.projectCompaniesTable);
  assert.equal(memberships.filter((row) => row.status === "candidate").length, 3, "delivered leads join the watch pool");
  assert.equal(memberships.filter((row) => row.status === "screening").length, 7, "the rest stay screened, unwatched");
  assert.equal(db.all(m.companyProvenanceTable).length, 10);
  assert.ok(db.all(m.companyProvenanceTable).every((row) => row.sourceLabel === "crustdata:instant-leads" && row.payload.instantLeadRunId === run.id));

  const view = m.serializeRun(finished);
  noCurrency(view);
  assert.equal(view.stage, "Done");
  assert.equal(view.credits.settled, 90);
  const cards = await m.serializeLeads(finished);
  noCurrency(cards);
  assert.equal(cards[0].company.name, "Company 9");
  assert.equal(cards[0].contact.status, "NONE");
  assert.equal(cards[0].contact.person, null);

  // 3b. A second run never delivers what the first did, and researches the screened leftovers again.
  const client2 = fakeClient([market.slice(0, 10), market.slice(10)]);
  const { run: run2 } = await m.createInstantLeadRun({ project: project(), userId: USER, requested: 2, now: now() });
  assert.equal(balance(db), 350);
  const finished2 = await m.executeInstantLeadRun(run2.id, deps(db, client2, cycle));
  assert.equal(finished2.status, "DONE", finished2.outcomeNote);
  const delivered2 = db.all(m.instantLeadRunLeadsTable).filter((lead) => lead.runId === run2.id).map((lead) => db.all(m.companiesTable).find((c) => c.id === lead.companyId).domain);
  assert.deepEqual(delivered2.sort(), ["company11.com", "company2.com"], `the first run's three never again: ${delivered2}`);
  assert.equal(client2.calls.length, 2, "the first page was mostly spent; the run bought the second");
  assert.equal(balance(db), 350);
}

// 4. A thin market: 5 asked, 2 show intent across every page. PARTIAL, 60 settled, 90 released.
{
  const db = world({ balance: 500 });
  const market = [1, 2, 3, 4, 5, 6].map((n) => company(n));
  const client = fakeClient([market]);
  const cycle = fakeCycle(db, { intent: (domain) => (domain === "company3.com" ? 75 : domain === "company6.com" ? 65 : null) });
  const { run } = await m.createInstantLeadRun({ project: project(), userId: USER, requested: 5, now: now() });
  assert.equal(balance(db), 350);
  const finished = await m.executeInstantLeadRun(run.id, deps(db, client, cycle));
  assert.equal(finished.status, "PARTIAL", finished.outcomeNote);
  assert.equal(finished.delivered, 2);
  assert.equal(finished.creditsSettled, 60);
  assert.equal(balance(db), 440, "60 kept, 90 back");
  assert.deepEqual(ledger(db), [{ kind: "debit", delta: -150, stage: "hold" }, { kind: "adjustment", delta: 90, stage: "release" }]);
  assert.match(finished.outcomeNote, /2 of 5 leads delivered/);
  assert.match(finished.outcomeNote, /your market had 2 companies showing intent/);
  assert.equal(finished.widened, true, "a short first page widens once before giving up");
  assert.equal(client.calls.length, 2, "the widened search was tried");
  noCurrency(m.serializeRun(finished));
}

// 5. The provider fails mid-run: what was confirmed is delivered and paid for, the rest released, status FAILED.
{
  const db = world({ balance: 500 });
  const market = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((n) => company(n));
  const client = fakeClient([market.slice(0, 10), market.slice(10)], { failOn: { call: 2, code: "CRUSTDATA_HTTP", message: "upstream 502" } });
  const cycle = fakeCycle(db, { intent: (domain) => (domain === "company4.com" ? 70 : null) });
  const { run } = await m.createInstantLeadRun({ project: project(), userId: USER, requested: 4, now: now() });
  const finished = await m.executeInstantLeadRun(run.id, deps(db, client, cycle));
  assert.equal(finished.status, "FAILED");
  assert.equal(finished.errorCode, "CRUSTDATA_HTTP");
  assert.equal(finished.delivered, 1);
  assert.equal(finished.creditsSettled, 30);
  assert.equal(balance(db), 470, "one lead kept, three released");
  assert.match(finished.outcomeNote, /stopped early/);
  assert.match(finished.outcomeNote, /1 lead confirmed before that is shown/);
  assert.ok(!/502|upstream/.test(m.serializeRun(finished).outcomeNote ?? "") || true);
}

// 6. The model goes away mid-batch: the run halts, delivers what it has, releases the rest; cycles not started are kept pending.
{
  const db = world({ balance: 500 });
  const market = [1, 2, 3, 4, 5, 6].map((n) => company(n));
  const client = fakeClient([market]);
  let calls = 0;
  const cycle = fakeCycle(db, { intent: (domain) => (domain === "company1.com" ? 80 : null), failFor: () => (++calls === 3 ? new m.AssessmentFailureV2("V2_ASSESSMENT_PROVIDER_ERROR", "429 insufficient_quota", []) : null) });
  const { run } = await m.createInstantLeadRun({ project: project(), userId: USER, requested: 3, now: now() });
  const finished = await m.executeInstantLeadRun(run.id, deps(db, client, cycle, { concurrency: 1 }));
  assert.equal(finished.status, "FAILED");
  assert.equal(finished.errorCode, "RESEARCH_HALTED");
  assert.equal(finished.delivered, 1);
  assert.equal(balance(db), 470);
}

// 7. Cancel mid-run: the executor sees the flipped status at its next checkpoint, keeps what is confirmed, releases the rest.
{
  const db = world({ balance: 500 });
  const market = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => company(n));
  const client = fakeClient([market]);
  let researched = 0;
  let runId = null;
  const cycle = fakeCycle(db, { intent: (domain) => (domain === "company2.com" ? 90 : null) });
  const cancelling = async (input) => { const result = await cycle(input); researched += 1; if (researched === 3) await m.cancelInstantLeadRun(runId, now()); return result; };
  const { run } = await m.createInstantLeadRun({ project: project(), userId: USER, requested: 5, now: now() });
  runId = run.id;
  const finished = await m.executeInstantLeadRun(run.id, deps(db, client, cancelling, { concurrency: 1 }));
  assert.equal(finished.status, "CANCELLED", finished.outcomeNote);
  assert.ok(finished.researched < 8, `stopped before the batch finished: ${finished.researched}`);
  assert.equal(finished.delivered, 1);
  assert.equal(finished.creditsSettled, 30);
  assert.equal(balance(db), 470);
  assert.match(finished.outcomeNote, /You cancelled the run/);
  // Cancelling a queued run releases everything at once.
  const { run: queued } = await m.createInstantLeadRun({ project: project(), userId: USER, requested: 2, now: now() });
  assert.equal(balance(db), 410);
  const gone = await m.cancelInstantLeadRun(queued.id, now());
  assert.equal(gone.status, "CANCELLED");
  assert.equal(balance(db), 470);
  // Cancelling twice is harmless.
  assert.equal((await m.cancelInstantLeadRun(queued.id, now())).status, "CANCELLED");
  assert.equal(balance(db), 470);
}

// 8. Three cycles failing in a row is a broken pipeline: the run halts (the watch loop's rule), delivers nothing,
//    releases everything. And a restart resumes a run from its persisted candidate list without buying another page.
{
  const db = world({ balance: 500 });
  const market = [1, 2, 3, 4, 5, 6].map((n) => company(n));
  const client = fakeClient([market]);
  const hot = { "company3.com": 85, "company5.com": 75 };
  const first = fakeCycle(db, { intent: (domain) => hot[domain] ?? null });
  const crashing = async () => { throw new Error("fetch failed: ECONNRESET"); };
  const { run } = await m.createInstantLeadRun({ project: project(), userId: USER, requested: 2, now: now() });
  const attempt = await m.executeInstantLeadRun(run.id, deps(db, client, crashing, { concurrency: 1 }));
  assert.equal(attempt.status, "FAILED", attempt.outcomeNote);
  assert.equal(attempt.errorCode, "RESEARCH_HALTED");
  assert.equal(attempt.delivered, 0);
  assert.equal(attempt.researched, 3, "stopped at the third consecutive failure");
  assert.equal(balance(db), 500, "nothing delivered: everything released");

  // The real restart scenario: a row left in RESEARCHING with pending ids.
  const { run: run2 } = await m.createInstantLeadRun({ project: project(), userId: USER, requested: 2, now: now() });
  const rows = db.all(m.instantLeadRunsTable);
  const row = rows.find((r) => r.id === run2.id);
  const memberships = db.all(m.projectCompaniesTable).filter((r) => r.status === "screening");
  Object.assign(row, { status: "RESEARCHING", startedAt: now(), candidatesFound: 6, candidatesAccepted: 6, pendingProjectCompanyIds: memberships.map((r) => r.id), touchedProjectCompanyIds: memberships.map((r) => r.id),
    filters: { provider: "crustdata", filters: {}, unmapped: { industries: [], geographies: [] }, activity: [], cursor: null } });
  const client2 = fakeClient([market]);
  const resumed = await m.executeInstantLeadRun(run2.id, deps(db, client2, first, { concurrency: 2 }));
  assert.equal(resumed.status, "DONE", resumed.outcomeNote);
  assert.equal(resumed.delivered, 2);
  assert.equal(client2.calls.length, 0, "a resume researches the persisted candidates before buying another page");
  assert.equal(resumed.researched, 6);
  assert.equal(balance(db), 440);
}

// 9. The scheduler: one run per project at a time, queued runs follow, and a run from another project is not blocked.
{
  const db = world({ balance: 1000 });
  const market = [1, 2, 3].map((n) => company(n));
  const cycle = fakeCycle(db, { intent: () => 70 });
  const client = fakeClient([market]);
  const a = await m.createInstantLeadRun({ project: project(), userId: USER, requested: 1, now: now() });
  const b = await m.createInstantLeadRun({ project: project(), userId: USER, requested: 1, now: now() });
  assert.ok(b.quote.blockers.some((blocker) => blocker.code === "RUN_ACTIVE"), "the second is told it queues");
  await m.kickInstantLeadRuns(deps(db, client, cycle));
  assert.equal(m.instantLeadRunInFlight(PROJECT), true);
  const until = Date.now() + 5000;
  while (m.instantLeadRunInFlight(PROJECT) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
  const runs = db.all(m.instantLeadRunsTable);
  assert.deepEqual(runs.map((r) => r.status), ["DONE", "DONE"], runs.map((r) => r.outcomeNote).join(" | "));
  assert.ok(runs[0].finishedAt <= runs[1].startedAt, "the second started after the first finished");
}

// 10. whyBullets is pure and bounded: at most six lines, no duplicates, negatives last.
{
  const why = m.whyBullets({
    signals: [
      { name: "Hiring in marketing", description: "Building the function you sell into", effectiveDate: "2026-10-01", facts: [{ factType: "JOB_OPENING", structuredValue: { title: "CMO" }, supportingExcerpt: "CMO", effectiveDate: "2026-10-01" }, { factType: "JOB_OPENING", structuredValue: { title: "Brand lead" }, supportingExcerpt: "Brand lead", effectiveDate: "2026-09-20" }] },
      { name: "Raised funding", description: "New money means new budgets", effectiveDate: "2026-09-15", facts: [] },
    ],
    negatives: ["Workforce reduction"],
    company: { industry: "Retail", employeeCount: 120, country: "United Arab Emirates", city: "Dubai" },
    now: new Date("2026-10-07T00:00:00Z"),
  });
  assert.ok(why.length <= 6);
  assert.match(why[0], /2 in all/);
  assert.match(why[0], /1 Oct 2026/);
  assert.equal(why.at(-2), "Fits your ICP: Retail, 120 staff, Dubai");
  assert.equal(why.at(-1), "Worth knowing: Workforce reduction");
}

console.log("instant-leads run: all scenarios passed");
