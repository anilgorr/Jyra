/**
 * The ICP and the pack, as the provider will read them.
 *
 * What it must get right: the first pilot's ICP (13 industries, 10-200
 * staff, Middle East + India) becomes a query with three firmographic
 * conditions and an OR-group of activity conditions; each pack category
 * maps to the one Crustdata field that can see it, or is reported as
 * something research must do instead; widening loosens thresholds and
 * never the market; the client prices and files every call.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const m = await loadHermetic("./scripts/instant-leads-filters-test-entry.ts", "/tmp/jyra-instant-leads-filters.cjs");

const NOW = new Date("2026-10-07T10:00:00.000Z");
const f30Criteria = [
  { dimension: "employee_count", operator: "BETWEEN", value: { min: 10, max: 200 }, accepted: true },
  { dimension: "geography", operator: "IN", value: ["Middle East", "India"], accepted: true },
  { dimension: "industry", operator: "IN", value: ["it", "Energy", "Pharma", "Edtech", "Healthtech", "Manufacturing", "Automotive", "Fintech", "Construction", "Fashion", "Professional services", "Logistics", "IT services"], accepted: true },
  { dimension: "negative_indicator", operator: "CONTAINS", value: "Prospects with no budget", accepted: true },
  { dimension: "geography", operator: "IN", value: ["Mars"], accepted: false },
];
const marketingPack = [
  { code: "MARKETING_NEW_CMO", category: "LEADERSHIP", polarity: "POSITIVE", factTypes: ["LEADERSHIP_CHANGE"], matchAny: ["cmo", "marketing", "growth"], lifetimeDays: 90 },
  { code: "MARKETING_TEAM_GROWTH", category: "HIRING", polarity: "POSITIVE", factTypes: ["JOB_OPENING", "HIRING_COUNT"], matchAny: ["marketing", "growth", "demand generation"], lifetimeDays: 90 },
  { code: "GO_TO_MARKET_EXPANSION", category: "HIRING", polarity: "POSITIVE", factTypes: ["JOB_OPENING", "HIRING_COUNT"], matchAny: ["sales", "presales", "sdr", "bdr"], lifetimeDays: 90 },
  { code: "MARKETING_GROWTH_FUNDING", category: "FUNDING", polarity: "POSITIVE", factTypes: ["FUNDING_EVENT"], matchAny: [], lifetimeDays: 180 },
  { code: "MARKETING_MARTECH_CHANGE", category: "TECHNOLOGY", polarity: "POSITIVE", factTypes: ["TECHNOLOGY_MENTION"], matchAny: ["crm", "hubspot"], lifetimeDays: 90 },
  { code: "WORKFORCE_REDUCTION", category: "NEGATIVE", polarity: "NEGATIVE", factTypes: ["WORKFORCE_REDUCTION"], matchAny: [], lifetimeDays: 180 },
];

// 1. The F30 plan.
{
  const plan = m.buildInstantLeadFilters({ criteria: f30Criteria, definitions: marketingPack, now: NOW });
  assert.deepEqual(plan.resolved.headcount, { min: 10, max: 200 });
  assert.deepEqual(plan.resolved.countries, ["ARE", "SAU", "QAT", "OMN", "BHR", "KWT", "JOR", "LBN", "EGY", "IND"], "the unaccepted 'Mars' is ignored; the accepted two expand");
  assert.deepEqual(plan.unmapped, { industries: [], geographies: [] });
  assert.ok(plan.resolved.industries.length >= 13, "13 labels become at least 13 provider names");
  const fields = plan.firmographic.map((c) => c.field);
  assert.deepEqual(fields, ["headcount.total", "headcount.total", "locations.country", "basic_info.industries"]);

  const byCode = Object.fromEntries(plan.activity.map((a) => [a.code, a]));
  assert.equal(byCode.MARKETING_TEAM_GROWTH.field, "roles.growth_6m.marketing", "a HIRING rule with marketing words becomes marketing role growth");
  assert.equal(byCode.GO_TO_MARKET_EXPANSION.field, "roles.growth_6m.sales");
  assert.equal(byCode.MARKETING_GROWTH_FUNDING.field, "funding.last_fundraise_date");
  assert.equal(byCode.MARKETING_GROWTH_FUNDING.value, "2026-04-10", "a round within the rule's 180-day lifetime");
  assert.equal(byCode.MARKETING_NEW_CMO.field, "headcount.growth_percent.3m", "leadership has no filter; a growth proxy stands in");
  assert.ok(!byCode.MARKETING_MARTECH_CHANGE, "technology mentions cannot be searched");
  assert.ok(plan.skippedDefinitions.some((s) => s.code === "MARKETING_MARTECH_CHANGE"));
  assert.ok(plan.skippedDefinitions.some((s) => s.code === "WORKFORCE_REDUCTION" && /negative/.test(s.reason)));

  assert.equal(plan.filters.op, "and");
  const orGroup = plan.filters.conditions.find((c) => c.op === "or");
  assert.ok(orGroup && orGroup.conditions.length === 4, "activity is one OR group of four");
  assert.deepEqual(plan.sorts, [{ field: "headcount.growth_percent.6m", order: "desc" }]);

  const words = m.describeFilterPlan(plan, { country: m.countryLabel });
  assert.equal(words[0], "10–200 employees");
  assert.ok(words[1].startsWith("UAE, Saudi Arabia"));
  assert.ok(words.at(-1).startsWith("looking for:"));
}

// 2. A city ICP pins the city; "Global" means no country filter; a rule with keywords Crustdata has no function for falls back to open roles.
{
  const plan = m.buildInstantLeadFilters({
    criteria: [{ dimension: "geography", operator: "IN", value: ["Dubai"], accepted: true }],
    definitions: [{ code: "X_HIRING", category: "HIRING", polarity: "POSITIVE", factTypes: ["JOB_OPENING"], matchAny: ["welder", "forklift"], lifetimeDays: 60 }],
    now: NOW,
  });
  assert.deepEqual(plan.firmographic.map((c) => [c.field, c.value]), [["locations.country", ["ARE"]], ["locations.city", ["Dubai"]]]);
  assert.equal(plan.activity[0].field, "hiring.openings_count");
  const global = m.buildInstantLeadFilters({ criteria: [{ dimension: "geography", operator: "IN", value: ["Global"], accepted: true }], definitions: [], now: NOW });
  assert.deepEqual(global.firmographic, []);
  assert.equal(global.filters.conditions.length, 0);
}

// 3. Widening loosens thresholds and drops the city pin; the market never widens. Dropping a refused field keeps the rest.
{
  const plan = m.buildInstantLeadFilters({ criteria: [...f30Criteria, { dimension: "geography", operator: "IN", value: ["Bengaluru"], accepted: true }], definitions: marketingPack, now: NOW });
  const wide = m.widenInstantLeadFilters(plan);
  assert.equal(wide.activity.find((a) => a.code === "MARKETING_NEW_CMO").value, 0);
  assert.ok(wide.firmographic.every((c) => c.field !== "locations.city"));
  assert.deepEqual(wide.firmographic.find((c) => c.field === "locations.country").value, plan.firmographic.find((c) => c.field === "locations.country").value, "countries unchanged");
  const without = m.withoutField(plan, "roles.growth_6m.marketing");
  assert.ok(without.activity.every((a) => a.field !== "roles.growth_6m.marketing"));
  assert.ok(without.skippedDefinitions.some((s) => s.code === "MARKETING_TEAM_GROWTH" && /refused/.test(s.reason)));
  assert.equal(without.activity.length, plan.activity.length - 1);
}

// 4. Unmapped labels are reported, not guessed; an ICP with an unknown place still searches what it knows.
{
  const plan = m.buildInstantLeadFilters({
    criteria: [
      { dimension: "industry", operator: "IN", value: ["Underwater basket weaving", "Pharma"], accepted: true },
      { dimension: "geography", operator: "IN", value: ["Atlantis", "India"], accepted: true },
    ], definitions: [], now: NOW,
  });
  assert.deepEqual(plan.unmapped, { industries: ["Underwater basket weaving"], geographies: ["Atlantis"] });
  assert.deepEqual(plan.resolved.countries, ["IND"]);
  assert.deepEqual(plan.resolved.industries, ["Pharmaceutical Manufacturing"]);
}

// 5. The client: files every call, prices by result count when the provider does not report credits, names failures.
{
  const calls = [];
  const spend = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    if (url.endsWith("/company/search")) return new Response(JSON.stringify({ companies: [
      { basic_info: { name: "Acme Pharma", primary_domain: "www.AcmePharma.in", industries: ["Pharmaceutical Manufacturing"] }, headcount: { total: 120, growth_percent: { "6m": 18.2, "3m": 6 } }, locations: { country: "IND", city: "Hyderabad" }, funding: { last_fundraise_date: "2026-06-01", last_round_type: "series_a", total_investment_usd: 4000000 } },
      { basic_info: { name: "No Domain Ltd" }, headcount: { total: 50 } },
    ], total_count: 2, next_cursor: null }), { status: 200 });
    if (url.endsWith("/person/search")) return new Response(JSON.stringify({ profiles: [
      { crustdata_person_id: 1068035, basic_profile: { name: "Priya Menon", current_title: "Head of Marketing" }, experience: { employment_details: { current: { name: "Acme Pharma", company_website_domain: "acmepharma.in", seniority_level: "Director", function_category: "Marketing" } } }, social_handles: { professional_network_identifier: { profile_url: "https://www.linkedin.com/in/priyamenon" } }, contact: { has_business_email: true } },
    ], total_count: 1 }), { status: 200 });
    if (url.endsWith("/person/contact/enrich")) return new Response(JSON.stringify([
      { matched_on: "https://www.linkedin.com/in/priyamenon", match_type: "professional_network_profile_url", matches: [{ confidence_score: 1, person_data: { crustdata_person_id: 1068035, contact: { business_emails: [{ email: "Priya.Menon@acmepharma.in", status: "deliverable" }] } } }] },
    ]), { status: 200 });
    return new Response("nope", { status: 404 });
  };
  const client = m.createCrustdataClient({ apiKey: "k", fetchImpl, configuration: { usdPerCredit: 0.1, requestsPerMinute: 1000 }, limiter: { take: async () => {} }, recordSpend: async (entry) => { spend.push(entry); } });
  const scope = { organizationId: "org", projectId: "proj", requestId: "r1" };

  const companies = await client.searchCompanies({ filters: { op: "and", conditions: [] }, limit: 50 }, scope);
  assert.equal(companies.items.length, 2);
  assert.equal(companies.items[0].domain, "acmepharma.in", "domains are lower-cased and stripped of www");
  assert.equal(companies.items[0].headcountGrowth6m, 18.2);
  assert.equal(companies.items[0].lastRoundType, "series_a");
  assert.equal(companies.items[1].domain, null);
  assert.equal(companies.creditsUsed, 0.06, "0.03 a result, two results");
  assert.equal(calls[0].headers["x-api-version"], "2025-11-01");
  assert.equal(calls[0].headers.Authorization, "Bearer k");
  assert.equal(calls[0].body.limit, 50);

  const people = await client.searchPeople({ filters: { op: "and", conditions: [] }, limit: 10 }, scope);
  assert.equal(people.items[0].name, "Priya Menon");
  assert.equal(people.items[0].linkedinUrl, "https://www.linkedin.com/in/priyamenon");
  assert.equal(people.items[0].seniority, "Director");
  assert.equal(people.items[0].id, "1068035");

  const contact = await client.enrichContact({ linkedinUrl: "https://www.linkedin.com/in/priyamenon" }, scope);
  assert.deepEqual(contact.contact.emails, [{ email: "priya.menon@acmepharma.in", status: "deliverable" }]);
  assert.equal(contact.creditsUsed, 1.5, "1 credit plus 0.5 for verification");
  assert.deepEqual(calls[2].body, { professional_network_profile_urls: ["https://www.linkedin.com/in/priyamenon"], fields: ["contact.business_emails"], verified: true });

  assert.equal(spend.length, 3, "one ledger row per call");
  assert.equal(spend[0].source, "Crustdata");
  assert.equal(spend[0].capability, "COMPANY_DISCOVERY");
  assert.equal(spend[0].outcome, "success");
  assert.equal(Math.round(spend[0].costUsd * 1000) / 1000, 0.006);
  assert.equal(spend[0].metadata.usdPerCreditVerified, false, "the placeholder rate says it is one");
  assert.equal(spend[2].capability, "EMAIL_LOOKUP");

  // Failures are named, filed at zero cost, and say whether retrying is worth it.
  const failing = m.createCrustdataClient({ apiKey: "k", fetchImpl: async () => new Response("quota", { status: 402 }), limiter: { take: async () => {} }, recordSpend: async (entry) => { spend.push(entry); } });
  await assert.rejects(() => failing.searchCompanies({ filters: { op: "and", conditions: [] }, limit: 1 }, scope), (error) => error.code === "CRUSTDATA_NO_CREDITS" && error.retryable === false);
  assert.equal(spend.at(-1).outcome, "failed");
  assert.equal(spend.at(-1).costUsd, 0);
  assert.equal(m.crustdataFailureMessage(new m.CrustdataError("CRUSTDATA_NO_CREDITS", "x", false)), "The company data provider's balance is empty.");
  const unconfigured = m.createCrustdataClient({ apiKey: undefined, limiter: { take: async () => {} }, recordSpend: async () => {} });
  await assert.rejects(() => unconfigured.searchCompanies({ filters: { op: "and", conditions: [] }, limit: 1 }, scope), (error) => error.code === "CRUSTDATA_NOT_CONFIGURED");

  // Configuration: the env rate wins over the row, and marks itself verified.
  const configured = m.crustdataConfiguration({ usdPerCredit: 0.1 }, { CRUSTDATA_USD_PER_CREDIT: "0.02" });
  assert.equal(configured.usdPerCredit, 0.02);
  assert.equal(configured.usdPerCreditVerified, true);
  assert.equal(m.crustdataConfiguration({ usdPerCredit: 0.1 }, {}).usdPerCreditVerified, false);
}

console.log("PASS instant-leads-filters");
