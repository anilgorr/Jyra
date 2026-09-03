// Deterministic regression suite for the intelligence-v2 rule fixes
// (B1, B6, B7, B8, B9, B12, B13, discovery matching, R5). No DB, no network.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";
process.env.JYRA_INTELLIGENCE_VERSION = "JYRA_INTELLIGENCE_V2";
if (process.env.NODE_ENV === "production") throw new Error("this suite must not run with NODE_ENV=production");

const output = "/tmp/jyra-intelligence-v2-rules.cjs";
await build({ entryPoints: ["./scripts/test-intelligence-v2-rules-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node", logLevel: "silent" });
const v2 = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const scope = { organizationId: "org-a", projectId: "project-a", companyId: "company-acme" };
const NOW = new Date("2026-01-01T00:00:00.000Z");
const req = (overrides) => ({ criterionId: "c", type: "INDUSTRY", operator: "EQUALS", mandatory: true, exclusion: false, preferred: false, ...overrides });

const evidenceItem = ({ id = "ev-1", claims = [], firstParty = true, url = "https://acme.example/about", sourceType = "FIRST_PARTY_WEBSITE", snippet = "Acme Security sells business software." } = {}) => ({
  evidenceId: id, ...scope, sourceType, provider: "fixture", url, finalUrl: url, title: "Acme Security about page",
  observedAt: NOW.toISOString(), rawSnippet: snippet, firstParty, confidence: .9, version: "v1",
  atomicClaims: [{ claimId: `${id}:brand`, type: "BRAND_MATCH", value: "Acme Security" }, ...claims],
  claims: { primaryBusiness: snippet, businessModel: "SAAS" },
});

/* ---------------- B1 identity source policy ---------------- */
test("B1 MARKET_READINESS_CAMPAIGN source can resolve identity from first-party evidence", () => {
  const item = evidenceItem();
  const resolved = v2.resolveCompanyV2({ companyName: "Acme Security", domain: "acme.example", source: "MARKET_READINESS_CAMPAIGN", firstPartyEvidence: [item] });
  assert.equal(resolved.status, "RESOLVED");
  const unknownSource = v2.resolveCompanyV2({ companyName: "Acme Security", domain: "acme.example", source: "SOMETHING_ELSE", firstPartyEvidence: [item] });
  assert.equal(unknownSource.status, "IDENTITY_UNCERTAIN");
  assert.match(unknownSource.reason, /identity policy/);
  const noEvidence = v2.resolveCompanyV2({ companyName: "Acme Security", domain: "acme.example", source: "MARKET_READINESS_CAMPAIGN", firstPartyEvidence: [] });
  assert.equal(noEvidence.status, "IDENTITY_UNCERTAIN", "source trust never substitutes for evidence");
  assert.equal(v2.identitySourcePolicyV2("MARKET_READINESS_CAMPAIGN").allowsEvidenceResolution, true);
  assert.equal(v2.identitySourcePolicyV2("nope").allowsEvidenceResolution, false);
});

/* ---------------- B7 ICP criterion mapping + evaluation ---------------- */
test("B7 icp-engine criteria map to typed requirements instead of JSON strings", () => {
  const industry = v2.icpCriterionToRequirementV2({ id: "i", dimension: "industry", operator: "IN", value: ["Manufacturing", "Logistics"], criterionType: "MUST_HAVE", description: "Target industries." });
  assert.deepEqual({ type: industry.type, operator: industry.operator, value: industry.value, mandatory: industry.mandatory }, { type: "INDUSTRY", operator: "IN", value: ["Manufacturing", "Logistics"], mandatory: true });
  const geography = v2.icpCriterionToRequirementV2({ id: "g", dimension: "geography", operator: "IN", value: ["US", "Canada"], criterionType: "MUST_HAVE" });
  assert.equal(geography.type, "GEOGRAPHY"); assert.deepEqual(geography.value, ["US", "Canada"]);
  const employees = v2.icpCriterionToRequirementV2({ id: "e", dimension: "employee_count", operator: "BETWEEN", value: { min: 50, max: 500 }, criterionType: "MUST_HAVE" });
  assert.deepEqual({ type: employees.type, operator: employees.operator, value: employees.value }, { type: "EMPLOYEE_SIZE", operator: "BETWEEN", value: { min: 50, max: 500 } });
  const openEnded = v2.icpCriterionToRequirementV2({ id: "e2", dimension: "employee_count", operator: "BETWEEN", value: { min: 1000, max: null }, criterionType: "MUST_HAVE" });
  assert.deepEqual(openEnded.value, { min: 1000 });
  const revenue = v2.icpCriterionToRequirementV2({ id: "r", dimension: "revenue", operator: "GTE", value: 5_000_000, criterionType: "PREFERRED" });
  assert.deepEqual({ type: revenue.type, operator: revenue.operator, value: revenue.value, preferred: revenue.preferred }, { type: "ICP_CRITERION", operator: "GTE", value: { min: 5_000_000 }, preferred: true });
  const negative = v2.icpCriterionToRequirementV2({ id: "n", dimension: "negative_indicator", operator: "CONTAINS", value: "government agency", criterionType: "DISQUALIFIER" });
  assert.deepEqual({ type: negative.type, operator: negative.operator, value: negative.value, exclusion: negative.exclusion, mandatory: negative.mandatory }, { type: "ICP_CRITERION", operator: "CONTAINS", value: "government agency", exclusion: true, mandatory: false });
  assert.equal(v2.icpCriterionToRequirementV2({ id: "b", dimension: "compliance", operator: "BOOLEAN", value: true, criterionType: "PREFERRED" }).operator, "EXISTS");
  assert.equal(v2.icpCriterionToRequirementV2({ id: "b2", dimension: "compliance", operator: "BOOLEAN", value: false, criterionType: "PREFERRED" }), null);
  for (const requirement of [industry, geography, employees, openEnded, revenue, negative]) assert.ok(v2.researchRequirementSchema.safeParse(requirement).success);
  assert.doesNotMatch(v2.describeRequirementV2(industry), /[{}"]/, "description never renders raw JSON");
  assert.match(v2.describeRequirementV2(negative), /^EXCLUSION \(PASS means the company EXHIBITS/);
});
test("B7 IN / EQUALS / CONTAINS match whole tokens and aliases, never bare substrings", () => {
  const geo = req({ type: "GEOGRAPHY", operator: "IN", value: ["US", "Canada"] });
  assert.equal(v2.criterionSatisfiedBy(geo, "Austin, Texas, United States"), true);
  assert.equal(v2.criterionSatisfiedBy(geo, "USA"), true);
  assert.equal(v2.criterionSatisfiedBy(geo, "Australia"), false, "'us' must not match inside 'australia'");
  assert.equal(v2.criterionSatisfiedBy(geo, "Toronto, Canada"), true);
  assert.equal(v2.criterionSatisfiedBy(geo, "Germany"), false);
  const industry = req({ type: "INDUSTRY", operator: "IN", value: ["Manufacturing"] });
  assert.equal(v2.criterionSatisfiedBy(industry, "Industrial Machinery Manufacturing"), true);
  assert.equal(v2.criterionSatisfiedBy(industry, "Manufacturers of pumps"), true, "singular/plural tolerant");
  assert.equal(v2.criterionSatisfiedBy(industry, "Remanufacturing"), false, "no substring inside another token");
  assert.equal(v2.criterionSatisfiedBy(req({ operator: "EQUALS", value: "Software" }), "software"), true);
  assert.equal(v2.criterionSatisfiedBy(req({ operator: "EQUALS", value: "Software" }), "Software Development"), false);
  assert.equal(v2.criterionSatisfiedBy(req({ operator: "CONTAINS", value: "government agency" }), "Serves every federal government agency in the region"), true);
  assert.equal(v2.criterionSatisfiedBy(req({ operator: "NOT_CONTAINS", value: "government" }), "B2B SaaS for retailers"), true);
  assert.equal(v2.criterionSatisfiedBy(req({ operator: "NOT_CONTAINS", value: "government" }), "Government contractor"), false);
  assert.equal(v2.criterionSatisfiedBy(req({ operator: "EXISTS", value: undefined }), "anything"), true);
});
test("B7 numeric operators parse claim strings and count range overlap", () => {
  assert.deepEqual(v2.parseNumericClaimValueV2("200"), { min: 200, max: 200 });
  assert.deepEqual(v2.parseNumericClaimValueV2("1,000+"), { min: 1000, max: Infinity });
  assert.deepEqual(v2.parseNumericClaimValueV2("51-200 employees"), { min: 51, max: 200 });
  assert.deepEqual(v2.parseNumericClaimValueV2("$5M - $10M revenue"), { min: 5e6, max: 10e6 });
  assert.equal(v2.parseNumericClaimValueV2("founded in 1999 with a global team"), null, "free text is not a number");
  const between = req({ type: "EMPLOYEE_SIZE", operator: "BETWEEN", value: { min: 50, max: 200 } });
  assert.equal(v2.criterionSatisfiedBy(between, "51-200 employees"), true);
  assert.equal(v2.criterionSatisfiedBy(between, "120"), true);
  assert.equal(v2.criterionSatisfiedBy(between, "201-500 employees"), false);
  assert.equal(v2.criterionSatisfiedBy(between, "1,000+"), false);
  assert.equal(v2.criterionSatisfiedBy(between, "10-49"), false);
  assert.equal(v2.criterionSatisfiedBy(between, "Mid-sized team"), null, "undecidable, never FAIL");
  assert.equal(v2.criterionSatisfiedBy(req({ type: "EMPLOYEE_SIZE", operator: "GTE", value: { min: 100 } }), "51-200 employees"), true, "range overlap counts");
  assert.equal(v2.criterionSatisfiedBy(req({ type: "EMPLOYEE_SIZE", operator: "GTE", value: { min: 100 } }), "10-49 employees"), false);
  assert.equal(v2.criterionSatisfiedBy(req({ type: "EMPLOYEE_SIZE", operator: "LTE", value: { max: 100 } }), "51-200 employees"), true);
  assert.equal(v2.criterionSatisfiedBy(req({ type: "EMPLOYEE_SIZE", operator: "LTE", value: { max: 100 } }), "1,000+"), false);
  assert.equal(v2.criterionSatisfiedBy(req({ type: "EMPLOYEE_SIZE", operator: "EQUALS", value: "200" }), "200 employees"), true);
  const evidence = [evidenceItem({ claims: [{ claimId: "ev-1:employees", type: "EMPLOYEE_SIZE", value: "51-200 employees" }] })];
  assert.equal(v2.researchRequirementStatusV2(evidence, req({ criterionId: "e", type: "EMPLOYEE_SIZE", operator: "BETWEEN", value: { min: 50, max: 200 } })), "PASS");
  assert.equal(v2.researchRequirementStatusV2(evidence, req({ criterionId: "e", type: "EMPLOYEE_SIZE", operator: "BETWEEN", value: { min: 500, max: 900 } })), "FAIL");
  assert.equal(v2.researchRequirementStatusV2(evidence, req({ criterionId: "r", type: "ICP_CRITERION", operator: "GTE", value: { min: 5e6 }, dimension: "revenue" })), "UNKNOWN", "revenue never decided by employee counts or prose");
});
test("B7 validator accepts a correctly passing NOT_CONTAINS and wildcard-dimension bindings", () => {
  const item = evidenceItem({ claims: [{ claimId: "ev-1:business", type: "PRIMARY_BUSINESS", value: "B2B SaaS for retailers" }] });
  const notContains = req({ criterionId: "neg", type: "ICP_CRITERION", operator: "NOT_CONTAINS", value: "government", mandatory: false, exclusion: true, dimension: "negative_indicator" });
  const contains = req({ criterionId: "pos", type: "ICP_CRITERION", operator: "CONTAINS", value: "retailers", mandatory: false, dimension: "positive_indicator" });
  const context = { icp: { requirements: [notContains, contains] } };
  const binding = (purpose, relation) => ({ claimId: "ev-1:business", claimedValue: "B2B SaaS for retailers", purpose, relation });
  const criterion = (requirement, result, relation) => ({
    criterionId: requirement.criterionId, description: v2.describeRequirementV2(requirement), mandatory: requirement.mandatory, exclusion: requirement.exclusion,
    result, confidence: .8, reason: "The cited claim decides this criterion.", evidenceIds: ["ev-1"], claimIds: ["ev-1:business"], claimBindings: [binding(requirement.criterionId, relation)],
  });
  const assessment = {
    commercialRole: { value: "POTENTIAL_BUYER", confidence: .8, reason: "Buyer.", evidenceIds: ["ev-1"], claimIds: ["ev-1:business"], claimBindings: [binding("role", "SUPPORTS_ROLE")] },
    who: { value: "POSSIBLE_FIT", confidence: .7, reason: "Fit.", evidenceIds: ["ev-1"], claimIds: ["ev-1:business"], claimBindings: [binding("WHO", "SUPPORTS_WHO")],
      criteria: [criterion(notContains, "PASS", "SATISFIES_CRITERION"), criterion(contains, "PASS", "SATISFIES_CRITERION")] },
    uncertainties: [], assessmentConfidence: .8,
  };
  const validation = v2.validateAssessmentEvidenceV2(assessment, [item], context);
  assert.deepEqual(validation.ok ? [] : validation.errors, []);
  const normalized = v2.normalizeAssessmentEvidenceV2(assessment, [item], context);
  assert.deepEqual(normalized.who.criteria.map((c) => c.result), ["PASS", "PASS"], "wildcard dimensions are evaluable, not permanently UNKNOWN");
  const wrong = structuredClone(assessment);
  wrong.who.criteria[0].result = "FAIL"; wrong.who.criteria[0].claimBindings[0].relation = "FAILS_CRITERION";
  const rejected = v2.validateAssessmentEvidenceV2(wrong, [item], context);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some((error) => /claim value\/relation does not match/.test(error)));
});

/* ---------------- B12 geography semantics ---------------- */
test("B12 only HQ / primary operating geography can decide an ICP geography criterion", () => {
  const item = evidenceItem({ claims: [
    { claimId: "ev-1:geo-office", type: "GEOGRAPHY", value: "United States", geographyType: "OFFICE_PRESENCE" },
    { claimId: "ev-1:geo-hq", type: "GEOGRAPHY", value: "Germany", geographyType: "HEADQUARTERS" },
    { claimId: "ev-1:geo-legacy", type: "GEOGRAPHY", value: "Germany" },
  ] });
  const requirement = req({ criterionId: "geo", type: "GEOGRAPHY", operator: "IN", value: ["US"] });
  const context = { icp: { requirements: [requirement] } };
  const build = (claimId, value, result, relation) => ({
    commercialRole: { value: "UNKNOWN", confidence: .3, reason: "Unknown.", evidenceIds: [], claimIds: [], claimBindings: [] },
    who: { value: "INSUFFICIENT_DATA", confidence: .3, reason: "Insufficient.", evidenceIds: [], claimIds: [], claimBindings: [],
      criteria: [{ criterionId: "geo", description: v2.describeRequirementV2(requirement), mandatory: true, result, confidence: .8, reason: "Cited.",
        evidenceIds: ["ev-1"], claimIds: [claimId], claimBindings: [{ claimId, claimedValue: value, purpose: "geo", relation }] }] },
    uncertainties: [], assessmentConfidence: .5,
  });
  const officePass = build("ev-1:geo-office", "United States", "PASS", "SATISFIES_CRITERION");
  const normalized = v2.normalizeAssessmentEvidenceV2(officePass, [item], context);
  assert.equal(normalized.who.criteria[0].result, "UNKNOWN", "office presence cannot PASS geography");
  assert.match(normalized.who.criteria[0].reason, /office, customer or talent presence/);
  const rejected = v2.validateAssessmentEvidenceV2(officePass, [item], context);
  assert.ok(!rejected.ok && rejected.errors.some((error) => /geography claim semantics \(OFFICE_PRESENCE\)/.test(error)));
  const hqFail = build("ev-1:geo-hq", "Germany", "FAIL", "FAILS_CRITERION");
  assert.equal(v2.validateAssessmentEvidenceV2(hqFail, [item], context).ok, true);
  const legacyFail = build("ev-1:geo-legacy", "Germany", "FAIL", "FAILS_CRITERION");
  assert.equal(v2.validateAssessmentEvidenceV2(legacyFail, [item], context).ok, true, "legacy untyped geography still decides");
  assert.equal(v2.researchRequirementStatusV2([item], requirement), "FAIL", "research sufficiency ignores office presence too");
});
test("B12 canonical profile types 'based in' as HQ only when the company is the subject", () => {
  const company = { id: "company", canonicalName: "Acme Factory", domain: "acme.test", website: "https://acme.test", linkedinUrl: null, profileUrls: {}, country: null, industry: null, employeeCount: null, employeeRange: null, description: null, createdAt: NOW, updatedAt: NOW };
  const row = (excerpt, id) => ({ id, sourceType: "COMPANY_PROFILE_RESOLUTION", sourceLabel: "resolver", sourceUrl: "https://directory.test/acme", observedAt: NOW, createdAt: NOW,
    payload: { provider: "resolver", result: { resolutionStatus: "VERIFIED", candidates: [{ resolutionStatus: "VERIFIED", searchResultExcerpt: excerpt }] } } });
  const partner = v2.selectIcpReadyCompanyFacts(company, [row("Acme Factory works with distributors based in Berlin, Germany.", "row-1")]);
  assert.equal(partner.geography, null, "a partner 'based in' is not headquarters");
  assert.equal(partner.otherLocations.length, 1);
  assert.equal(partner.otherLocations[0].normalizedValue.locationType, "OFFICE_LOCATION");
  assert.equal(partner.otherLocations[0].normalizedValue.iso2, "DE");
  assert.equal(partner.otherLocations[0].confidence, .6);
  const self = v2.selectIcpReadyCompanyFacts(company, [row("Acme Factory is based in Austin, Texas, United States. Distributors based in Berlin, Germany carry its products.", "row-2")]);
  assert.equal(self.geography?.normalizedValue?.iso2, "US");
  assert.equal(self.geography?.normalizedValue?.locationType, "HEADQUARTERS");
  assert.equal(self.geography?.confidence, .8);
  assert.deepEqual(self.otherLocations.map((fact) => fact.normalizedValue.iso2), ["DE"]);
  const we = v2.selectIcpReadyCompanyFacts(company, [row("We are based in Toronto, Canada and headquartered in Toronto, Canada.", "row-3")]);
  assert.equal(we.geography?.normalizedValue?.iso2, "CA");
});

/* ---------------- B8 / B9 safety rules ---------------- */
const profileFor = (identityStatus = "RESOLVED") => ({
  version: "company-intelligence-profile-v2", ...scope, companyName: "Acme Security", domain: "acme.example",
  identity: { status: identityStatus, confidence: .9, reason: "ok", evidenceIds: ["ev-1"] }, primaryBusiness: null, productsServices: [], businessModel: null, industry: null,
  geography: { headquarters: null, primaryOperatingGeography: null, offices: [], otherPresence: [], confidence: 0, evidenceIds: [] },
  employeeSize: null, technologyFacts: [], offeringOverlapFacts: [], unknownFields: [], profileConfidence: .9, createdAt: NOW.toISOString(), fingerprint: "fp",
});
const baseAssessment = (who, criteria) => ({
  commercialRole: { value: "POTENTIAL_BUYER", confidence: .8, reason: "Buyer.", evidenceIds: ["ev-1"], claimIds: ["ev-1:business"], claimBindings: [{ claimId: "ev-1:business", claimedValue: "B2B SaaS", purpose: "role", relation: "SUPPORTS_ROLE" }] },
  who: { value: who, confidence: .7, reason: "Fit.", evidenceIds: ["ev-1"], claimIds: ["ev-1:business"], claimBindings: [{ claimId: "ev-1:business", claimedValue: "B2B SaaS", purpose: "WHO", relation: "SUPPORTS_WHO" }], criteria },
  uncertainties: [], assessmentConfidence: .8,
});
const citedCriterion = (overrides) => ({
  criterionId: "x", description: "ICP_CRITERION CONTAINS government", mandatory: false, result: "PASS", confidence: .8, reason: "Cited.",
  evidenceIds: ["ev-1"], claimIds: ["ev-1:business"], claimBindings: [{ claimId: "ev-1:business", claimedValue: "B2B SaaS", purpose: "x", relation: "SATISFIES_CRITERION" }], ...overrides,
});
test("B8 a cited exclusion PASS forces LIKELY_NOT_FIT under EXCLUSION_MATCH", () => {
  const result = v2.applySafetyRulesV2({ profile: profileFor(), fingerprint: "fp", assessment: baseAssessment("LIKELY_FIT", [citedCriterion({ exclusion: true })]) });
  assert.equal(result.who.value, "LIKELY_NOT_FIT");
  assert.deepEqual(result.deterministicOverrides, ["EXCLUSION_MATCH"]);
  assert.equal(result.resolutionType, "EXCLUSION_MATCH");
  assert.deepEqual(result.who.claimIds, ["ev-1:business"]);
  // Exclusion resolved from ICP context when the cached criterion lacks the flag.
  const fromContext = v2.applySafetyRulesV2({ profile: profileFor(), fingerprint: "fp", assessment: baseAssessment("POSSIBLE_FIT", [citedCriterion({})]),
    context: { icp: { requirements: [req({ criterionId: "x", type: "ICP_CRITERION", operator: "CONTAINS", value: "government", mandatory: false, exclusion: true })] } } });
  assert.equal(fromContext.who.value, "LIKELY_NOT_FIT");
  assert.deepEqual(fromContext.deterministicOverrides, ["EXCLUSION_MATCH"]);
  // An exclusion FAIL (company shown NOT to exhibit it) or an uncited PASS does nothing.
  const fail = v2.applySafetyRulesV2({ profile: profileFor(), fingerprint: "fp", assessment: baseAssessment("LIKELY_FIT", [citedCriterion({ exclusion: true, result: "FAIL", claimBindings: [{ claimId: "ev-1:business", claimedValue: "B2B SaaS", purpose: "x", relation: "FAILS_CRITERION" }] })]) });
  assert.equal(fail.who.value, "LIKELY_FIT");
  const uncited = v2.applySafetyRulesV2({ profile: profileFor(), fingerprint: "fp", assessment: baseAssessment("LIKELY_FIT", [citedCriterion({ exclusion: true, evidenceIds: [], claimIds: [], claimBindings: [] })]) });
  assert.equal(uncited.who.value, "LIKELY_FIT");
  assert.deepEqual(uncited.deterministicOverrides, []);
});
test("B9 a cited mandatory FAIL overrides POSSIBLE_FIT as well as LIKELY_FIT", () => {
  const failing = citedCriterion({ mandatory: true, result: "FAIL", claimBindings: [{ claimId: "ev-1:business", claimedValue: "B2B SaaS", purpose: "x", relation: "FAILS_CRITERION" }] });
  for (const who of ["LIKELY_FIT", "POSSIBLE_FIT"]) {
    const result = v2.applySafetyRulesV2({ profile: profileFor(), fingerprint: "fp", assessment: baseAssessment(who, [failing]) });
    assert.equal(result.who.value, "LIKELY_NOT_FIT", who);
    assert.deepEqual(result.deterministicOverrides, ["MANDATORY_CRITERION_FAILURE"]);
  }
  const insufficient = v2.applySafetyRulesV2({ profile: profileFor(), fingerprint: "fp", assessment: baseAssessment("INSUFFICIENT_DATA", [failing]) });
  assert.equal(insufficient.who.value, "INSUFFICIENT_DATA");
  const twoFailures = v2.applySafetyRulesV2({ profile: profileFor(), fingerprint: "fp", assessment: baseAssessment("POSSIBLE_FIT", [failing, { ...failing, criterionId: "y" }]) });
  assert.equal(twoFailures.who.claimBindings.length, 1, "WHO bindings are de-duplicated by claimId");
});

/* ---------------- B6 offering overlap end-to-end ---------------- */
const offering = { name: "Managed SOC", description: "24/7 security operations centre as a service.", materialCapabilities: ["24/7 threat detection and response", "security incident triage"] };
test("B6 offering overlap detection is conservative", () => {
  const hits = v2.detectOfferingOverlapV2("Acme Security provides managed SOC services with 24/7 threat detection and response for mid-market firms.", offering);
  assert.deepEqual(hits.map((hit) => hit.phrase), ["Managed SOC", "24/7 threat detection and response"]);
  assert.ok(hits.every((hit) => hit.excerpt.includes(hit.mode === "PHRASE" ? "managed SOC" : "threat")));
  assert.deepEqual(v2.detectOfferingOverlapV2("A managed services platform provider for the cloud.", offering), [], "generic vocabulary never overlaps");
  assert.deepEqual(v2.detectOfferingOverlapV2("Our SOC team keeps the factory floor safe.", offering), [], "one token is not enough");
  const tokens = v2.detectOfferingOverlapV2("We triage every security incident for our clients within minutes.", offering);
  assert.deepEqual(tokens.map((hit) => [hit.phrase, hit.mode]), [["security incident triage", "TOKENS"]]);
  assert.deepEqual(v2.detectOfferingOverlapV2("Security is important. Much later in an unrelated paragraph far away from the first sentence we mention that a doctor performs triage after an incident in the hospital emergency room where staff work.", { name: "security incident triage" }), [], "tokens must co-occur closely");
  assert.deepEqual(v2.detectOfferingOverlapV2("Anything at all", { name: "Managed Services Platform" }), [], "an all-generic offering never overlaps");
});
const fakeRouter = (pageText, extra = {}) => ({
  calls: [],
  async crawlWebsite() {
    this.calls.push("crawl");
    return { status: "success", providerId: "fake-crawl", providerRequestId: "crawl-1", data: { page: { url: "https://acme.example/", title: "Acme Security", text: pageText }, pages: [{ url: "https://acme.example/", title: "Acme Security", text: pageText }] }, sources: [], usage: { estimatedCost: .02, actualCost: .02 }, error: null, retryable: false, capturedAt: NOW.toISOString() };
  },
  async resolveCompanyProfile() { this.calls.push("resolve"); return { status: "success", providerId: "fake-resolve", providerRequestId: "resolve-1", data: { candidates: [] }, sources: [], usage: { estimatedCost: 0 }, error: null, retryable: false, capturedAt: NOW.toISOString() }; },
  async enrichCompany() { this.calls.push("enrich"); return { status: "success", providerId: "fake-enrich", providerRequestId: "enrich-1", data: extra.attributes ? { attributes: extra.attributes } : null, sources: [], usage: { estimatedCost: 0 }, error: null, retryable: false, capturedAt: NOW.toISOString() }; },
  async lookupCompany() { this.calls.push("lookup"); return { status: "success", providerId: "fake-lookup", providerRequestId: "lookup-1", data: null, sources: [], usage: { estimatedCost: 0 }, error: null, retryable: false, capturedAt: NOW.toISOString() }; },
  async searchWeb() { this.calls.push("search"); return { status: "success", providerId: "fake-search", providerRequestId: "search-1", data: { results: [] }, sources: [], usage: { estimatedCost: 0 }, error: null, retryable: false, capturedAt: NOW.toISOString() }; },
});
// A deterministic stand-in for the model: it binds OFFERING_OVERLAP claims as
// MATERIAL_SUBSTITUTE and otherwise reports a potential buyer.
const overlapAwareInvoker = async ({ payload }) => {
  const claims = payload.evidence.flatMap((item) => item.atomicClaims);
  const overlap = claims.find((claim) => claim.type === "OFFERING_OVERLAP");
  const business = claims.find((claim) => claim.type === "PRIMARY_BUSINESS");
  const criteria = (payload.icp.requirements ?? []).map((requirement) => ({ criterionId: requirement.criterionId, result: "UNKNOWN", confidence: .5, reason: "No claim decides it.", citations: [] }));
  const content = overlap
    ? { commercialRole: { value: "SELLER_COMPETITOR", confidence: .85, reason: "The company sells the seller's offering.", citations: [{ claimId: overlap.claimId, relation: "MATERIAL_SUBSTITUTE" }] },
        who: { value: "LIKELY_FIT", confidence: .6, reason: "Structurally similar.", citations: [{ claimId: business.claimId, relation: "SUPPORTS_WHO" }], criteria } }
    : { commercialRole: { value: "POTENTIAL_BUYER", confidence: .8, reason: "Operating company.", citations: [{ claimId: business.claimId, relation: "SUPPORTS_ROLE" }] },
        who: { value: "POSSIBLE_FIT", confidence: .6, reason: "Plausible.", citations: [{ claimId: business.claimId, relation: "SUPPORTS_WHO" }], criteria } };
  return { content: { ...content, uncertainties: [], assessmentConfidence: .8 }, usage: { total_tokens: 50 }, cost: .003 };
};
const orchestrate = (router, extra = {}) => v2.orchestrateIntelligenceV2({
  request: { ...scope, companyName: "Acme Security", domain: "acme.example", source: "MARKET_READINESS_CAMPAIGN", firstPartyEvidence: [] },
  context: { organizationId: scope.organizationId, projectId: scope.projectId, businessTwinVersion: "twin-v1", offeringVersion: "offering-v1", icpVersion: "icp-v1",
    sellerBusinessTwin: { business: "MSSP" }, offering, icp: { requirements: extra.requirements ?? [] } },
  repository: extra.repository ?? new v2.InMemoryIntelligenceV2Repository(),
  researchInvoker: v2.createProviderRouterResearchInvokerV2(router, { onProviderCost: extra.onProviderCost }),
  assessmentInvoker: extra.assessmentInvoker ?? overlapAwareInvoker, now: NOW, ...(extra.callbacks ?? {}),
});
test("B6 a company whose page sells the seller's offering becomes SELLER_COMPETITOR then LIKELY_NOT_FIT", async () => {
  const router = fakeRouter("Acme Security provides managed SOC services and 24/7 threat detection and response to mid-market companies across North America.");
  const result = await orchestrate(router);
  assert.equal(result.profile.identity.status, "RESOLVED", "campaign source resolves from first-party evidence (B1)");
  const overlapClaims = result.evidence.flatMap((item) => item.atomicClaims).filter((claim) => claim.type === "OFFERING_OVERLAP");
  assert.deepEqual(overlapClaims.map((claim) => claim.value), ["Managed SOC", "24/7 threat detection and response"]);
  assert.ok(result.profile.offeringOverlapFacts.some((fact) => /Managed SOC — "/.test(fact.value)), "excerpt recorded as support");
  assert.equal(result.assessment.commercialRole.value, "SELLER_COMPETITOR");
  assert.equal(result.assessment.who.value, "LIKELY_NOT_FIT");
  assert.deepEqual(result.assessment.deterministicOverrides, ["COMMERCIAL_ROLE_EXCLUSION"]);
  assert.equal(result.assessment.resolutionType, "COMMERCIAL_ROLE_EXCLUSION");
});
test("B6 a company with only generic vocabulary stays a potential buyer", async () => {
  const router = fakeRouter("Acme Security manufactures industrial door systems and runs a managed services platform for facility operators.");
  const result = await orchestrate(router);
  assert.deepEqual(result.evidence.flatMap((item) => item.atomicClaims).filter((claim) => claim.type === "OFFERING_OVERLAP"), []);
  assert.equal(result.assessment.commercialRole.value, "POTENTIAL_BUYER");
  assert.equal(result.assessment.who.value, "POSSIBLE_FIT");
});
test("B6 provider firmographic specialties can evidence overlap; third-party search snippets cannot", async () => {
  const request = { ...scope, companyName: "Acme Security", domain: "acme.example", offering };
  const firmographic = v2.providerEvidence({ request, provider: "p", providerRequestId: "r1", capturedAt: NOW.toISOString(), sourceType: "COMPANY_FIRMOGRAPHICS", url: null, title: "profile",
    snippet: "Specialties: managed SOC, compliance", firstParty: false, claims: { primaryBusiness: "MSSP", productsServices: ["managed SOC"] } });
  assert.equal(firmographic.atomicClaims.filter((claim) => claim.type === "OFFERING_OVERLAP").length, 1);
  const thirdParty = v2.providerEvidence({ request, provider: "p", providerRequestId: "r2", capturedAt: NOW.toISOString(), sourceType: "WEB_SEARCH", url: "https://news.example/a", title: "news",
    snippet: "Acme Security picks a managed SOC vendor.", firstParty: false, claims: { primaryBusiness: "news" } });
  assert.equal(thirdParty.atomicClaims.filter((claim) => claim.type === "OFFERING_OVERLAP").length, 0);
});
test("B8 end-to-end: exclusion criterion PASS via wildcard binding excludes the company", async () => {
  const router = fakeRouter("Acme Security is a government agency contractor delivering facility maintenance to federal buildings.");
  const exclusion = v2.icpCriterionToRequirementV2({ id: "neg-1", dimension: "negative_indicator", operator: "CONTAINS", value: "government agency", criterionType: "DISQUALIFIER", description: "Seller does not sell to public sector." });
  const invoker = async (input) => {
    const base = await overlapAwareInvoker(input);
    const business = input.payload.evidence.flatMap((item) => item.atomicClaims).find((claim) => claim.type === "PRIMARY_BUSINESS");
    base.content.who.criteria = [{ criterionId: "neg-1", result: "PASS", confidence: .9, reason: "The page names a government agency role.", citations: [{ claimId: business.claimId, relation: "SATISFIES_CRITERION" }] }];
    return base;
  };
  const result = await orchestrate(router, { requirements: [exclusion], assessmentInvoker: invoker });
  assert.equal(result.assessment.who.criteria[0].result, "PASS");
  assert.match(result.assessment.who.criteria[0].description, /^EXCLUSION \(PASS means the company EXHIBITS/);
  assert.equal(result.assessment.who.value, "LIKELY_NOT_FIT");
  assert.deepEqual(result.assessment.deterministicOverrides, ["EXCLUSION_MATCH"]);
});

/* ---------------- B13 buyer-role heuristic ---------------- */
test("B13 generic overlap never yields a competitor; distinctive overlap is MEDIUM at most", () => {
  const assess = (input) => v2.assessBuyerRole({ offeringLabel: "AI visibility platform", sellerIndustry: "Software", targetIndustries: ["Retail"], now: NOW, ...input });
  const generic = assess({ name: "DataCo", description: "A data platform provider for the retail industry.", industry: "Retail" });
  assert.notEqual(generic.buyerRole, "SELLER_COMPETITOR");
  assert.equal(generic.buyerRole, "POTENTIAL_BUYER");
  const oneToken = assess({ name: "VisCo", description: "A visibility software provider for shipping.", industry: "Logistics" });
  assert.notEqual(oneToken.buyerRole, "SELLER_COMPETITOR", "one shared distinctive token is not overlap");
  const phrase = assess({ name: "SeeCo", description: "SeeCo is an AI visibility platform provider for brands.", industry: "Software" });
  assert.equal(phrase.buyerRole, "SELLER_COMPETITOR");
  assert.equal(phrase.confidence, "MEDIUM", "heuristic competitor calls are never HIGH");
  const twoTokens = v2.assessBuyerRole({ offeringLabel: "cyber threat detection", sellerIndustry: "Security", targetIndustries: ["Retail"], now: NOW, name: "ThreatCo", description: "A threat detection and response vendor.", industry: "Security" });
  assert.equal(twoTokens.buyerRole, "SELLER_COMPETITOR");
  assert.equal(twoTokens.confidence, "MEDIUM");
  assert.deepEqual(v2.offeringOverlapEvidence("AI visibility platform", "A data platform provider").distinctiveTokens, []);
  assert.equal(v2.offeringOverlapEvidence("solar installation", "Solar EPC contractor and installer.").phrase, true);
  assert.ok(v2.offeringOverlapEvidence("solar installation", "Solar EPC contractor and installer.").distinctiveTokens.length >= 2);
});

/* ---------------- discovery geography/industry match ---------------- */
test("discovery geography/industry checks match tokens and aliases, never substrings", () => {
  const company = (country, industry) => ({ canonicalName: "Candidate", name: "Candidate", domain: null, website: null, linkedinUrl: null, country, industry, description: null, employeeCount: null, employeeRange: null });
  const checks = (country, industry, strategy) => v2.qualifyCandidate(company(country, industry), strategy, null, null, "POTENTIAL_BUYER").checks;
  assert.equal(checks("Australia", null, { geographies: ["US"] }).geography, false, "'us' is not inside 'australia'");
  assert.equal(checks("United States", null, { geographies: ["US"] }).geography, true);
  assert.equal(checks("USA", null, { geographies: ["United States of America"] }).geography, true);
  assert.equal(checks("Austin, Texas, United States", null, { geographies: ["US"] }).geography, true);
  assert.equal(checks("United Kingdom", null, { geographies: ["UK"] }).geography, true);
  assert.equal(checks("Germany", null, { geographies: ["US", "Canada"] }).geography, false);
  assert.equal(checks(null, "Industrial Machinery Manufacturing", { targetIndustries: ["Manufacturing"] }).industry, true);
  assert.equal(checks(null, "Remanufacturing", { targetIndustries: ["Manufacturing"] }).industry, false);
  assert.equal(checks(null, "Software", { targetIndustries: ["Software Development"] }).industry, true, "token containment in either direction");
  assert.equal(checks(null, null, { targetIndustries: ["Manufacturing"] }).industry, null);
});

/* ---------------- R5 in-flight de-duplication ---------------- */
test("R5 a concurrent caller with cost callbacks records its own spend", async () => {
  const repository = new v2.InMemoryIntelligenceV2Repository();
  const pageText = "Acme Security manufactures industrial door systems for facility operators.";
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const slowInvoker = async (input) => { await gate; return overlapAwareInvoker(input); };
  const routerA = fakeRouter(pageText), routerB = fakeRouter(pageText);
  const costs = { a: { provider: 0, semantic: 0, attempts: 0 }, b: { provider: 0, semantic: 0, attempts: 0 } };
  const first = orchestrate(routerA, { repository, assessmentInvoker: slowInvoker, onProviderCost: (cost) => { costs.a.provider += cost; },
    callbacks: { onSemanticAttemptStart: () => { costs.a.attempts++; }, onSemanticCost: (cost) => { costs.a.semantic += cost; } } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = orchestrate(routerB, { repository, assessmentInvoker: slowInvoker, onProviderCost: (cost) => { costs.b.provider += cost; },
    callbacks: { onSemanticAttemptStart: () => { costs.b.attempts++; }, onSemanticCost: (cost) => { costs.b.semantic += cost; } } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.assessment.commercialRole.value, b.assessment.commercialRole.value);
  assert.ok(costs.a.semantic > 0 && costs.a.attempts === 1);
  assert.ok(costs.b.attempts === 1, "second caller's attempt callback fired");
  assert.ok(costs.b.semantic > 0, "second caller's semantic cost callback fired");
  assert.ok(costs.b.provider > 0 || b.observability.cache.research, "second caller either paid for research or observed a cache hit");
  assert.ok(!(costs.b.provider === 0 && costs.b.semantic === 0), "a run that spent money never records zero");
  // Callers without callbacks may still share an in-flight run.
  const sharedRepository = new v2.InMemoryIntelligenceV2Repository();
  let sharedRelease; const sharedGate = new Promise((resolve) => { sharedRelease = resolve; });
  let invocations = 0;
  const countingInvoker = async (input) => { invocations++; await sharedGate; return overlapAwareInvoker(input); };
  const x = orchestrate(fakeRouter(pageText), { repository: sharedRepository, assessmentInvoker: countingInvoker });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const y = orchestrate(fakeRouter(pageText), { repository: sharedRepository, assessmentInvoker: countingInvoker });
  sharedRelease();
  await Promise.all([x, y]);
  assert.equal(invocations, 1, "callback-free callers still de-duplicate");
});

let failed = 0;
for (const { name, fn } of tests) {
  try { await fn(); console.log(`ok   ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error?.stack ?? error}`); }
}
if (failed) { console.error(`\n${failed}/${tests.length} intelligence-v2 rule tests failed`); process.exit(1); }
console.log(`\nPASS ${tests.length}/${tests.length} intelligence-v2 rule tests`);
