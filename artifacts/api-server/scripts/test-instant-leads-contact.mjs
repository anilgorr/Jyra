/**
 * "Show contact", without a database or a provider.
 * @hermetic — the tables named below live in memory (scripts/lib/memdb.mjs).
 *
 * What must hold: the pack's buying roles pick the person (founder first at
 * a small company); the price follows the outcome (verified, catch-all,
 * name only, nobody found); the fallback waterfall is asked only when
 * Crustdata has no email; a second click is free and calls no provider;
 * short credits refuse before any provider call; a provider failure charges
 * nothing.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMemDb } from "./lib/memdb.mjs";

process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const stubPath = fileURLToPath(new URL("./fake-db-stub.ts", import.meta.url));
const output = "/tmp/jyra-instant-leads-contact-test.cjs";
await build({
  entryPoints: ["./scripts/instant-leads-contact-test-entry.ts"],
  outfile: output, bundle: true, format: "cjs", platform: "node", external: ["pg-native"],
  plugins: [{ name: "fake-workspace-db", setup(b) { b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: stubPath })); } }],
});
const m = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-07T10:00:00.000Z");
const MARKETING = {
  roles: [
    { label: "Marketing leader", seniorityLevels: ["CXO", "Vice President", "Director"], functionCategories: ["Marketing"], titleKeywords: ["cmo", "head of marketing", "marketing director"] },
    { label: "Marketing manager", seniorityLevels: ["Manager"], functionCategories: ["Marketing"], titleKeywords: ["marketing manager"] },
  ],
  fallbackUnderHeadcount: 50, fallbackTitles: ["founder", "ceo"],
};

function world({ balance = 100, headcount = 120 } = {}) {
  const db = createMemDb({ now: () => NOW });
  db.declareUnique(m.peopleTable, ["profileUrl"]);
  db.declareUnique(m.projectPersonContextTable, ["projectId", "projectCompanyId", "personId"]);
  db.declareUnique(m.personCompanyRolesTable, ["personId", "companyId", "role"]);
  db.seed(m.organizationsTable, [{ id: ORG, name: "F30" }]);
  db.seed(m.projectsTable, [{ id: PROJECT, organizationId: ORG, name: "Consulting" }]);
  db.seed(m.plansTable, [{ id: "plan-starter", code: "starter", name: "Starter", intentAccountsPerMonth: 20, watchPoolSize: 50, senderSeats: 1, creditsPerMonth: 500, priceInr: 0, priceUsd: 0, creditsPerInstantLead: 30, creditsPerContactVerified: 20, creditsPerContactCatchAll: 10 }]);
  db.seed(m.organizationCreditsTable, [{ organizationId: ORG, balance, monthlyAllowance: 500, periodStart: new Date("2026-10-01T00:00:00Z") }]);
  db.seed(m.signalPacksTable, [{ id: "pack-1", slug: "marketing", name: "Marketing buyers", description: "x", version: "1", status: "APPROVED", active: true, buyingRoles: MARKETING }]);
  db.seed(m.dataProvidersTable, [{ id: "prov-crust", name: "Crustdata", providerType: "crustdata", enabled: true, configuration: {} }]);
  const [company] = db.seed(m.companiesTable, [{ id: "co-1", canonicalName: "Acme Retail", domain: "acme.ae", website: "https://acme.ae", employeeCount: headcount, industry: "Retail", country: "United Arab Emirates" }]);
  const [projectCompany] = db.seed(m.projectCompaniesTable, [{ id: "pc-1", projectId: PROJECT, companyId: company.id, status: "candidate", buyerRole: "UNKNOWN" }]);
  const [run] = db.seed(m.instantLeadRunsTable, [{ id: "run-1", organizationId: ORG, projectId: PROJECT, requestedByUserId: "u", requested: 3, status: "DONE", creditsPerLead: 30, creditsHeld: 90, creditsSettled: 90, signalPackId: "pack-1", signalPackVersion: "1" }]);
  const [lead] = db.seed(m.instantLeadRunLeadsTable, [{ id: "lead-1", runId: run.id, projectId: PROJECT, projectCompanyId: projectCompany.id, companyId: company.id, rank: 1, score: 80, why: ["x"], signalCodes: ["HIRING_MARKETING"] }]);
  m.installFakeDb(db.resolver);
  return { db, run, lead, project: { id: PROJECT, organizationId: ORG, name: "Consulting" } };
}

const person = (overrides) => ({
  id: "p1", name: "Sara Khan", title: "Head of Marketing", seniority: "Director", functionCategory: "Marketing", companyName: "Acme Retail", companyDomain: "acme.ae",
  linkedinUrl: "https://www.linkedin.com/in/sarakhan", location: "Dubai", hasBusinessEmail: true, raw: {}, ...overrides,
});

function client({ people = [], emails = [], searchError = null, enrichError = null } = {}) {
  const calls = [];
  return {
    calls,
    configuration: {},
    async searchCompanies() { throw new Error("not here"); },
    async searchPeople(input, scope) { calls.push({ kind: "search", input, scope }); if (searchError) throw searchError; return { items: people, totalCount: people.length, nextCursor: null, creditsUsed: people.length * 0.03, costUsd: people.length * 0.003 }; },
    async enrichContact(input, scope) { calls.push({ kind: "enrich", input, scope }); if (enrichError) throw enrichError; return { contact: emails.length ? { emails, personId: "cp-1" } : null, creditsUsed: emails.length ? 1.5 : 0, costUsd: emails.length ? 0.15 : 0 }; },
  };
}
const deps = (c, fallback = async () => null) => ({ client: c, fallbackEmail: fallback, now: () => NOW, peopleLimit: 25 });
const balance = (db) => db.all(m.organizationCreditsTable)[0].balance;
const lead = (db) => db.all(m.instantLeadRunLeadsTable)[0];

// 1. Roles: the founder leads at a small company and trails at a large one; the search covers every role's seniority once.
{
  const large = m.rolesFor(MARKETING, 120).map((role) => role.label);
  assert.deepEqual(large, ["Marketing leader", "Marketing manager", "Founder"]);
  const small = m.rolesFor(MARKETING, 12).map((role) => role.label);
  assert.deepEqual(small, ["Founder", "Marketing leader", "Marketing manager"]);
  assert.deepEqual(m.rolesFor(null, null).map((role) => role.label), ["Founder"], "no pack roles: the founder is still someone");
  const filters = m.personSearchFilters("acme.ae", m.rolesFor(MARKETING, 120));
  assert.equal(filters.op, "and");
  assert.deepEqual(filters.conditions[0], { field: "experience.employment_details.current.company_website_domain", type: "=", value: "acme.ae" });
  assert.deepEqual(filters.conditions[1].value, ["CXO", "Vice President", "Director", "Manager", "Owner / Partner"]);
}

// 2. Picking: a title keyword beats a function match; a person without a LinkedIn profile is never picked; roles are tried in order.
{
  const roles = m.rolesFor(MARKETING, 120);
  const picked = m.pickBuyer([
    person({ id: "a", name: "Ops Director", title: "Operations Director", functionCategory: "Operations", seniority: "Director" }),
    person({ id: "b", name: "Marketing VP", title: "VP Brand", functionCategory: "Marketing", seniority: "Vice President" }),
    person({ id: "c", name: "CMO", title: "Chief Marketing Officer", functionCategory: "Marketing", seniority: "CXO" }),
  ], roles);
  assert.equal(picked.person.id, "c");
  assert.equal(picked.role.label, "Marketing leader");
  assert.match(picked.reason, /Marketing function at CXO level/, "the tie with the VP goes to the more senior person");
  const noProfile = m.pickBuyer([person({ linkedinUrl: null })], roles);
  assert.equal(noProfile, null, "no LinkedIn profile, no contact: the email lookup needs it");
  const manager = m.pickBuyer([person({ title: "Marketing Manager", seniority: "Manager" }), person({ id: "x", title: "Finance Director", functionCategory: "Finance", seniority: "Director" })], roles);
  assert.equal(manager.role.label, "Marketing manager", "the second role is reached when the first has nobody");
  assert.equal(m.pickBuyer([person({ id: "x", title: "Finance Director", functionCategory: "Finance", seniority: "Director" })], roles), null, "a director in the wrong function is not a marketing leader");
}

// 3. A verified email: 20 credits, the person persisted with the project context, the lead pinned; a second click is free and silent.
{
  const w = world({ balance: 100 });
  const c = client({ people: [person()], emails: [{ email: "sara@acme.ae", status: "deliverable" }] });
  const revealed = await m.revealLeadContact({ project: w.project, run: w.run, lead: w.lead, userId: "u", deps: deps(c) });
  assert.equal(revealed.status, "VERIFIED");
  assert.equal(revealed.credits, 20);
  assert.equal(revealed.person.email, "sara@acme.ae");
  assert.equal(revealed.person.linkedinUrl, "https://www.linkedin.com/in/sarakhan");
  assert.equal(revealed.person.roleLabel, "Marketing leader");
  assert.equal(balance(w.db), 80);
  assert.deepEqual(c.calls.map((call) => call.kind), ["search", "enrich"]);
  assert.equal(c.calls[1].input.verified, true);
  assert.equal(c.calls[0].scope.projectCompanyId, "pc-1");
  const row = lead(w.db);
  assert.equal(row.contactStatus, "VERIFIED");
  assert.equal(row.contactCredits, 20);
  assert.ok(row.contactPersonId && row.contactEntryId && row.contactRevealedAt);
  const people = w.db.all(m.peopleTable);
  assert.equal(people.length, 1);
  assert.equal(people[0].profileUrl, "https://www.linkedin.com/in/sarakhan");
  const context = w.db.all(m.projectPersonContextTable)[0];
  assert.equal(context.email, "sara@acme.ae");
  assert.equal(context.emailStatus, "VERIFIED");
  assert.equal(context.priority, "HIGH");
  assert.equal(w.db.all(m.contactEnrichmentAttemptsTable).length, 1);
  assert.equal(w.db.all(m.creditLedgerTable)[0].context.stage, "contact");

  const again = await m.revealLeadContact({ project: w.project, run: w.run, lead: lead(w.db), userId: "u", deps: deps(c) });
  assert.equal(again.status, "VERIFIED");
  assert.equal(again.credits, 20, "shows what was paid, charges nothing new");
  assert.equal(again.person.email, "sara@acme.ae");
  assert.equal(balance(w.db), 80);
  assert.equal(c.calls.length, 2, "no provider call on the second click");
  const cards = await m.serializeLeads(w.run);
  assert.equal(cards[0].contact.person.email, "sara@acme.ae");
  assert.equal(cards[0].contact.person.roleLabel, "Marketing leader");
}

// 4. A catch-all address is worth less: 10 credits.
{
  const w = world({ balance: 100 });
  const c = client({ people: [person()], emails: [{ email: "info@acme.ae", status: "catch_all" }] });
  const revealed = await m.revealLeadContact({ project: w.project, run: w.run, lead: w.lead, userId: "u", deps: deps(c) });
  assert.equal(revealed.status, "CATCH_ALL");
  assert.equal(revealed.credits, 10);
  assert.equal(balance(w.db), 90);
  assert.equal(w.db.all(m.projectPersonContextTable)[0].emailStatus, "FOUND");
}

// 5. Crustdata has no email: the fallback is asked; a verified answer there costs the verified price, nothing costs nothing.
{
  const w = world({ balance: 100 });
  const asked = [];
  const c = client({ people: [person()], emails: [] });
  const revealed = await m.revealLeadContact({ project: w.project, run: w.run, lead: w.lead, userId: "u", deps: deps(c, async (input) => { asked.push(input); return { email: "sara.khan@acme.ae", status: "VERIFIED" }; }) });
  assert.equal(revealed.status, "VERIFIED");
  assert.equal(revealed.credits, 20);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].personId, w.db.all(m.peopleTable)[0].id, "the fallback is asked about the persisted person");
  assert.equal(balance(w.db), 80);

  const w2 = world({ balance: 100 });
  const c2 = client({ people: [person()], emails: [{ email: "dead@acme.ae", status: "invalid" }] });
  const nameOnly = await m.revealLeadContact({ project: w2.project, run: w2.run, lead: w2.lead, userId: "u", deps: deps(c2) });
  assert.equal(nameOnly.status, "NAME_ONLY");
  assert.equal(nameOnly.credits, 0);
  assert.equal(nameOnly.person.name, "Sara Khan");
  assert.equal(nameOnly.person.email, null);
  assert.equal(nameOnly.person.linkedinUrl, "https://www.linkedin.com/in/sarakhan");
  assert.equal(balance(w2.db), 100, "a name and a profile without an email is free");
  assert.equal(w2.db.all(m.creditLedgerTable).length, 0);
  assert.equal(lead(w2.db).contactStatus, "NAME_ONLY");
}

// 6. Nobody fitting the roles: NOT_FOUND, free, no enrich call, the lead remembers so the button does not keep paying for searches.
{
  const w = world({ balance: 100 });
  const c = client({ people: [person({ title: "Warehouse Supervisor", functionCategory: "Operations", seniority: "Manager" })] });
  const revealed = await m.revealLeadContact({ project: w.project, run: w.run, lead: w.lead, userId: "u", deps: deps(c) });
  assert.equal(revealed.status, "NOT_FOUND");
  assert.equal(revealed.credits, 0);
  assert.equal(revealed.person, null);
  assert.deepEqual(c.calls.map((call) => call.kind), ["search"]);
  assert.equal(balance(w.db), 100);
  assert.equal(lead(w.db).contactStatus, "NOT_FOUND");
  const again = await m.revealLeadContact({ project: w.project, run: w.run, lead: lead(w.db), userId: "u", deps: deps(c) });
  assert.equal(again.status, "NOT_FOUND");
  assert.equal(c.calls.length, 1);
}

// 7. Short credits refuse before any provider call; a provider failure charges nothing and leaves the lead untouched.
{
  const w = world({ balance: 5 });
  const c = client({ people: [person()], emails: [{ email: "sara@acme.ae", status: "deliverable" }] });
  await assert.rejects(() => m.revealLeadContact({ project: w.project, run: w.run, lead: w.lead, userId: "u", deps: deps(c) }), (error) => error.code === "INSUFFICIENT_CREDITS" && error.status === 402);
  assert.equal(c.calls.length, 0);

  const w2 = world({ balance: 100 });
  const c2 = client({ searchError: new m.CrustdataError("CRUSTDATA_RATE_LIMITED", "slow down", true, 429) });
  await assert.rejects(() => m.revealLeadContact({ project: w2.project, run: w2.run, lead: w2.lead, userId: "u", deps: deps(c2) }), (error) => error.status === 503);
  assert.equal(balance(w2.db), 100);
  assert.equal(lead(w2.db).contactStatus, "NONE", "the button can be pressed again");

  // The enrich failing is not the reveal failing: the person is known, the fallback is tried, the name is shown.
  const w3 = world({ balance: 100 });
  const c3 = client({ people: [person()], enrichError: new m.CrustdataError("CRUSTDATA_HTTP", "500", false, 500) });
  const revealed = await m.revealLeadContact({ project: w3.project, run: w3.run, lead: w3.lead, userId: "u", deps: deps(c3) });
  assert.equal(revealed.status, "NAME_ONLY");
  assert.equal(balance(w3.db), 100);
}

// 8. A small company: the founder is the buyer even when a marketing manager exists.
{
  const w = world({ balance: 100, headcount: 15 });
  const c = client({ people: [person({ id: "mm", name: "Marketing Manager", title: "Marketing Manager", seniority: "Manager" }), person({ id: "f", name: "Omar Founder", title: "Founder & CEO", seniority: "CXO", functionCategory: "General Management", linkedinUrl: "https://www.linkedin.com/in/omar" })], emails: [{ email: "omar@acme.ae", status: "deliverable" }] });
  const revealed = await m.revealLeadContact({ project: w.project, run: w.run, lead: w.lead, userId: "u", deps: deps(c) });
  assert.equal(revealed.person.name, "Omar Founder");
  assert.equal(revealed.person.roleLabel, "Founder");
  assert.equal(w.db.all(m.personCompanyRolesTable)[0].role, "ECONOMIC_BUYER");
}

console.log("instant-leads contact: all scenarios passed");
