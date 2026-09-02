import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
process.env.JYRA_INTELLIGENCE_VERSION = "JYRA_INTELLIGENCE_V2";
const output = "/tmp/jyra-task-117-generic.cjs";
await build({ entryPoints: ["./scripts/task-117-generic-fixtures-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const v2 = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const ids = Array.from({ length: 10 }, (_, i) => `evidence-${i + 1}`);
const evidence = (claims, options = {}) => ({
  evidenceId: options.id ?? ids[0], organizationId: "org-a", companyId: "company-generic", projectId: "project-a",
  sourceType: options.sourceType ?? "FIRST_PARTY_WEBSITE", provider: "fixture",
  url: "https://generic.example/about", finalUrl: "https://generic.example/about", title: "Generic Company about page",
  observedAt: "2026-01-01T00:00:00.000Z", rawSnippet: options.snippet ?? "Generic company provides business software and services.",
  firstParty: options.firstParty ?? true, confidence: .9, version: options.version ?? "v1",
  atomicClaims: [
    { claimId: options.id ? `claim-brand-${options.id}` : "claim-brand", type: "BRAND_MATCH", value: "Generic Company" },
    ...(claims.primaryBusiness ? [{ claimId: "claim-business", type: "PRIMARY_BUSINESS", value: claims.primaryBusiness }] : []),
    ...(claims.productsServices ?? []).map((value, i) => ({ claimId: `claim-product-${i}`, type: "PRODUCT_SERVICE", value })),
    ...(claims.offeringOverlapFacts ?? []).map((value, i) => ({ claimId: `claim-overlap-${i}`, type: "OFFERING_OVERLAP", value })),
    ...(claims.geography ?? []).map((claim, i) => ({ claimId: `claim-geo-${i}`, type: "GEOGRAPHY", value: claim.value, geographyType: claim.type })),
  ], claims,
});
const resolved = (items, name = "Generic Company") => v2.resolveCompanyV2({ companyName: name, domain: "generic.example", source: "USER_ENTRY", firstPartyEvidence: items });
const profile = (items, identity = resolved(items)) => v2.buildCompanyProfileV2({ organizationId: "org-a", projectId: "project-a", companyId: "company-generic", identity, evidence: items, now: new Date("2026-01-01T00:00:00.000Z") });
const assessment = (role, who, evidenceIds = [ids[0]], criteria = []) => ({
  commercialRole: { value: role, confidence: .82, reason: "claim-business supports this seller-relative commercial relationship.", evidenceIds, claimIds: ["claim-business"], claimBindings: [{ claimId: "claim-business", claimedValue: "B2B SaaS", purpose: "commercial role", relation: "SUPPORTS_ROLE" }] },
  who: { value: who, confidence: .79, reason: "claim-business supports this structural ICP result.", evidenceIds, claimIds: ["claim-business"], claimBindings: [{ claimId: "claim-business", claimedValue: "B2B SaaS", purpose: "WHO", relation: "SUPPORTS_WHO" }], criteria },
  uncertainties: [], assessmentConfidence: .8,
});
const context = (icpVersion = "icp-v1", requirements = []) => ({
  organizationId: "org-a", projectId: "project-a", businessTwinVersion: "twin-v1",
  offeringVersion: "offering-v1", icpVersion, sellerBusinessTwin: { business: "Specialist provider" },
   offering: { name: "Managed outcome" }, icp: { target: "B2B companies", geography: "TARGET", requirements },
});
let providerCalls = 0;
const noExternal = async () => { providerCalls++; throw new Error("generic fixtures must make zero external calls"); };
class CountingRepository extends v2.InMemoryIntelligenceV2Repository {
  profileWrites = 0; researchWrites = 0;
  async putProfile(key, value) { this.profileWrites++; return super.putProfile(key, value); }
  async putResearch(key, value) { this.researchWrites++; return super.putResearch(key, value); }
}
let semanticCalls = 0;
const deterministicInvoker = async ({ payload }) => {
  semanticCalls++;
  const evidenceItems = payload.evidence;
  const claims = evidenceItems.flatMap((item) => item.atomicClaims.map((claim) => ({ ...claim, evidenceId: item.evidenceId })));
  const ids = [...new Set(claims.map((claim) => claim.evidenceId))];
  const claimIds = claims.filter((claim) => ["PRIMARY_BUSINESS", "PRODUCT_SERVICE", "OFFERING_OVERLAP"].includes(claim.type)).map((claim) => claim.claimId);
  const text = claims.map((claim) => claim.value).join(" ").toLowerCase();
  const role = text.includes("same managed monitoring outcome") || text.includes("same ai visibility outcome") ? "SELLER_COMPETITOR"
    : /vulnerability|application security|risk quantification/.test(text) ? "ADJACENT_VENDOR" : "POTENTIAL_BUYER";
  const geography = claims.find((claim) => claim.type === "GEOGRAPHY" && claim.geographyType === "HEADQUARTERS")?.value;
  const who = role === "SELLER_COMPETITOR" ? "LIKELY_NOT_FIT" : geography === "TARGET" ? "LIKELY_FIT" : "POSSIBLE_FIT";
  const roleClaim = claims.find((claim) => role === "SELLER_COMPETITOR" ? claim.type === "OFFERING_OVERLAP" : claim.type === "PRIMARY_BUSINESS");
  const criteria = (payload.icp.requirements ?? []).map((requirement) => {
    const supporting = claims.find((claim) => claim.type === requirement.type);
    const pass = supporting && (requirement.operator === "EQUALS" ? supporting.value === requirement.value : supporting.value.includes(requirement.value ?? ""));
    return {
      criterionId: requirement.criterionId, result: pass ? "PASS" : supporting ? "FAIL" : "UNKNOWN", confidence: .8,
      reason: pass ? "The cited claim satisfies the criterion." : supporting ? "The cited claim fails the criterion." : "No supplied claim decides this criterion.",
      citations: supporting ? [{ claimId: supporting.claimId, relation: pass ? "SATISFIES_CRITERION" : "FAILS_CRITERION" }] : [],
    };
  });
  const result = {
    commercialRole: { value: role, confidence: .82, reason: "The cited claim supports this commercial relationship.", citations: [{ claimId: roleClaim.claimId, relation: role === "SELLER_COMPETITOR" ? "MATERIAL_SUBSTITUTE" : "SUPPORTS_ROLE" }] },
    who: { value: who, confidence: .79, reason: "The cited claim supports this structural ICP result.", citations: [{ claimId: roleClaim.claimId, relation: "SUPPORTS_WHO" }], criteria },
    uncertainties: [], assessmentConfidence: .8,
  };
  return { content: result, usage: { total_tokens: 100 }, cost: .001 };
};
// Deterministic invoker deliberately derives output from supplied atomic claims.
const ruleAwareInvoker = async (input) => {
  const response = await deterministicInvoker(input);
  const claimIds = input.payload.evidence.flatMap((item) => item.atomicClaims)
    .filter((claim) => ["PRIMARY_BUSINESS", "PRODUCT_SERVICE", "OFFERING_OVERLAP"].includes(claim.type)).map((claim) => claim.claimId);
  return response;
};
const run = (items, _modelResult, repository = new v2.InMemoryIntelligenceV2Repository(), icpVersion = "icp-v1", extra = {}, requirements = []) =>
  v2.orchestrateIntelligenceV2({
    request: { organizationId: "org-a", projectId: "project-a", companyId: "company-generic", companyName: "Generic Company",
      domain: "generic.example", source: "USER_ENTRY", firstPartyEvidence: items, ...extra },
     context: context(icpVersion, requirements), repository, researchInvoker: noExternal, assessmentInvoker: ruleAwareInvoker,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });

const tests = [];
const focusedAssertions = [];
const focused = (name, check) => { check(); focusedAssertions.push(name); };
const test = (category, name, fn) => tests.push({ category, name, fn });

test("CommercialRole/WHO", "1 obvious buyer", async () => {
  const item = evidence({ primaryBusiness: "B2B SaaS", businessModel: "SAAS", geography: [{ type: "HEADQUARTERS", value: "TARGET" }] });
  const result = await run([item], assessment("POTENTIAL_BUYER", "LIKELY_FIT"));
  assert.equal(result.assessment.commercialRole.value, "POTENTIAL_BUYER"); assert.equal(result.assessment.who.value, "LIKELY_FIT");
});
test("Geography/WHO", "2 buyer with uncertain geography", async () => {
  const item = evidence({ primaryBusiness: "B2B SaaS", businessModel: "SAAS" });
  const result = await run([item], assessment("POTENTIAL_BUYER", "POSSIBLE_FIT"));
  assert.equal(result.assessment.who.value, "POSSIBLE_FIT");
  const requirementItem = evidence({ primaryBusiness: "B2B SaaS", businessModel: "SAAS", geography: [{ type: "HEADQUARTERS", value: "TARGET" }] });
  focused("requirement PASS on matching value", () => assert.equal(v2.researchRequirementStatusV2([requirementItem], { criterionId: "geo", type: "GEOGRAPHY", operator: "EQUALS", value: "TARGET", mandatory: true, exclusion: false, preferred: false }), "PASS"));
  focused("requirement FAIL on conflicting value", () => assert.equal(v2.researchRequirementStatusV2([requirementItem], { criterionId: "geo", type: "GEOGRAPHY", operator: "EQUALS", value: "OTHER", mandatory: true, exclusion: false, preferred: false }), "FAIL"));
  focused("requirement UNKNOWN on absent evidence", () => assert.equal(v2.researchRequirementStatusV2([item], { criterionId: "tech", type: "TECHNOLOGY", operator: "CONTAINS", value: "required-stack", mandatory: true, exclusion: false, preferred: false }), "UNKNOWN"));
  focused("NOT_CONTAINS remains UNKNOWN without affirmative absence", () => assert.equal(v2.researchRequirementStatusV2([requirementItem], { criterionId: "excluded-geo", type: "GEOGRAPHY", operator: "NOT_CONTAINS", value: "OTHER", mandatory: false, exclusion: true, preferred: false }), "UNKNOWN"));
  focused("NOT_CONTAINS FAILS when prohibited value exists", () => assert.equal(v2.researchRequirementStatusV2([requirementItem], { criterionId: "excluded-geo", type: "GEOGRAPHY", operator: "NOT_CONTAINS", value: "TARGET", mandatory: false, exclusion: true, preferred: false }), "FAIL"));
  const negativeRequirement = { criterionId: "excluded-geo", type: "GEOGRAPHY", operator: "NOT_CONTAINS", value: "OTHER", mandatory: false, exclusion: true, preferred: false };
  const forged = { requirementId: "excluded-geo", absentValue: "OTHER", providerId: "fixture-router", providerRequestId: "crawl-1", capability: "WEBSITE_CRAWL", sourceEvidenceIds: [ids[0]], capturedAt: "2026-01-01T00:00:00.000Z", exhaustive: true };
  focused("forged caller exhaustive attestation remains UNKNOWN", () => assert.equal(v2.researchRequirementStatusV2([requirementItem], negativeRequirement, [forged], [{ source: "FIRST_PARTY", capability: "WEBSITE_CRAWL", external: true, status: "USED", provider: "fixture-router", cost: 0 }]), "UNKNOWN"));
});
test("CommercialRole/Safety", "3 direct outcome competitor", async () => {
  const item = evidence({ primaryBusiness: "AI search visibility consultancy", productsServices: ["answer engine optimization", "generative search optimization"], offeringOverlapFacts: ["same AI visibility outcome"] });
  const result = await run([item], assessment("SELLER_COMPETITOR", "LIKELY_NOT_FIT"));
  assert.equal(result.assessment.commercialRole.value, "SELLER_COMPETITOR"); assert.equal(result.assessment.who.value, "LIKELY_NOT_FIT");
});
test("CommercialRole", "4 traditional marketing agency remains buyer", async () => {
  const item = evidence({ primaryBusiness: "Marketing agency", productsServices: ["SEO", "paid media", "content", "social"], businessModel: "SERVICES" });
  const result = await run([item], assessment("POTENTIAL_BUYER", "POSSIBLE_FIT"));
  assert.equal(result.assessment.commercialRole.value, "POTENTIAL_BUYER");
});
test("CommercialRole/Safety", "5 managed monitoring competitor", async () => {
  const item = evidence({ primaryBusiness: "Managed security operations", productsServices: ["continuous SOC", "managed detection and response", "incident response"], offeringOverlapFacts: ["same managed monitoring outcome"] });
  const result = await run([item], assessment("SELLER_COMPETITOR", "LIKELY_NOT_FIT"));
  assert.deepEqual([result.assessment.commercialRole.value, result.assessment.who.value], ["SELLER_COMPETITOR", "LIKELY_NOT_FIT"]);
});
test("CommercialRole", "6 adjacent security vendor is not competitor", async () => {
  const item = evidence({ primaryBusiness: "Security software vendor", productsServices: ["vulnerability management", "application security", "risk quantification"] });
  const result = await run([item], assessment("ADJACENT_VENDOR", "POSSIBLE_FIT"));
  assert.notEqual(result.assessment.commercialRole.value, "SELLER_COMPETITOR");
});
test("CommercialRole", "7 security testing provider is not competitor", async () => {
  const item = evidence({ primaryBusiness: "Security testing provider", productsServices: ["penetration testing", "application security assessment"] });
  const result = await run([item], assessment("POTENTIAL_BUYER", "POSSIBLE_FIT"));
  assert.notEqual(result.assessment.commercialRole.value, "SELLER_COMPETITOR");
});
test("Geography", "8 office presence does not become headquarters", () => {
  const item = evidence({ primaryBusiness: "Software", businessModel: "SAAS", geography: [{ type: "HEADQUARTERS", value: "OTHER" }, { type: "OFFICE_PRESENCE", value: "TARGET" }] });
  const p = profile([item]); assert.equal(p.geography.headquarters.value, "OTHER"); assert.equal(p.geography.offices[0].value, "TARGET");
});
test("Geography", "9 talent market does not become operating geography", () => {
  const item = evidence({ primaryBusiness: "Software", businessModel: "SAAS", geography: [{ type: "TALENT_MARKET", value: "TARGET" }] });
  const p = profile([item]); assert.equal(p.geography.primaryOperatingGeography, null); assert.equal(p.geography.otherPresence[0].type, "TALENT_MARKET");
});
test("Identity", "10 normal exact-domain identity resolves", async () => {
  const item = evidence({ primaryBusiness: "Software" }, { snippet: "Generic Company builds software." });
  assert.equal(resolved([item]).status, "RESOLVED");
  const crawl = (page, metadata, trusted = []) => v2.createProviderRouterResearchInvokerV2({ crawlWebsite: async () => ({
    status: "success", providerId: "fixture-router", providerRequestId: `crawl-${page.url}`, data: { page, pages: [page] },
    sources: [], usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 1 },
    error: null, retryable: false, capturedAt: "2026-01-01T00:00:00.000Z", metadata,
  }) }, { trustedCompletenessProviderIds: trusted })({ source: "FIRST_PARTY", capability: "WEBSITE_CRAWL", external: true }, {
    organizationId: "org-a", projectId: "project-a", companyId: "company-generic", companyName: "Generic Company", domain: "generic.example",
  });
  const real = await crawl({ url: "https://generic.example/about", title: null, text: "Welcome to Generic, where our company builds software." });
  focused("titleless real-content brand resolves", () => assert.equal(resolved(real.evidence).status, "RESOLVED"));
  const multiPage = await v2.createProviderRouterResearchInvokerV2({ crawlWebsite: async () => ({
    status: "success", providerId: "fixture-router", providerRequestId: "shared-crawl-request",
    data: { pages: [
      { url: "https://generic.example/about", title: "About", text: "Generic Company builds software." },
      { url: "https://generic.example/products", title: "Products", text: "Generic Company sells analytics." },
    ] },
    sources: [], usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 2 },
    error: null, retryable: false, capturedAt: "2026-01-01T00:00:00.000Z", metadata: {},
  }) })({ source: "FIRST_PARTY", capability: "WEBSITE_CRAWL", external: true }, {
    organizationId: "org-a", projectId: "project-a", companyId: "company-generic", companyName: "Generic Company", domain: "generic.example",
  });
  focused("multi-page response has globally unique deterministic claim IDs", () => {
    const claimIds = multiPage.evidence.flatMap((item) => item.atomicClaims.map((claim) => claim.claimId));
    assert.equal(new Set(claimIds).size, claimIds.length);
    assert.doesNotThrow(() => v2.validateScopedEvidence(multiPage.evidence, {
      organizationId: "org-a", projectId: "project-a", companyId: "company-generic",
    }, "multi-page-fixture"));
  });
  const multiResult = await v2.createProviderRouterResearchInvokerV2({ searchWeb: async () => ({
    status: "success", providerId: "fixture-search", providerRequestId: "shared-search-request",
    data: { results: [
      { url: "https://generic.example/one", title: "One", snippet: "Generic Company builds software." },
      { url: "https://generic.example/two", title: "Two", snippet: "Generic Company sells analytics." },
    ] },
    sources: [], usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 2 },
    error: null, retryable: false, capturedAt: "2026-01-01T00:00:00.000Z", metadata: {},
  }) })({ source: "WEB_SEARCH", capability: "WEB_SEARCH", external: true }, {
    organizationId: "org-a", projectId: "project-a", companyId: "company-generic", companyName: "Generic Company", domain: "generic.example",
  });
  focused("multi-result search has globally unique claim IDs", () => {
    const claimIds = multiResult.evidence.flatMap((item) => item.atomicClaims.map((claim) => claim.claimId));
    assert.equal(new Set(claimIds).size, claimIds.length);
    assert.doesNotThrow(() => v2.validateScopedEvidence(multiResult.evidence, {
      organizationId: "org-a", projectId: "project-a", companyId: "company-generic",
    }, "multi-result-fixture"));
  });
  const attested = await crawl({ url: "https://generic.example/about", title: null, text: "Welcome to Generic, where our company builds software." }, { completenessAttestations: [{
    requirementId: "no-prohibited-service", absentValue: "prohibited service", capability: "WEBSITE_CRAWL",
    sourceEvidenceIds: [real.evidence[0].evidenceId], captureResult: "EXHAUSTIVE_COMPLETE",
  }] }, ["fixture-router"]);
  focused("exact server-adapter exhaustive attestation PASSES", () => assert.equal(v2.researchRequirementStatusV2(attested.evidence, {
    criterionId: "no-prohibited-service", type: "PRODUCT_SERVICE", operator: "NOT_CONTAINS", value: "prohibited service",
    mandatory: false, exclusion: true, preferred: false,
  }, attested.completenessAttestations, [{ source: "FIRST_PARTY", capability: "WEBSITE_CRAWL", external: true, status: "USED", provider: "fixture-router", cost: 0 }]), "PASS"));
  const parked = await crawl({ url: "https://generic.example", title: null, text: "This domain is parked and may be for sale." });
  focused("titleless parked unrelated content remains uncertain", () => assert.equal(resolved(parked.evidence).status, "IDENTITY_UNCERTAIN"));
  const redirected = await crawl({ url: "https://unrelated.example", title: null, text: "Generic Company builds software." });
  focused("redirected wrong final host remains uncertain", () => assert.equal(resolved(redirected.evidence).status, "IDENTITY_UNCERTAIN"));
});
test("Identity/Safety", "11 true identity conflict blocks action through orchestrator", async () => {
  const item = evidence({ primaryBusiness: "Software" }, { snippet: "Generic Company builds software." });
  const conflict = evidence({}, { id: ids[1], firstParty: false, snippet: "This domain belongs to a different organization." });
  const result = await run([item], assessment("POTENTIAL_BUYER", "LIKELY_FIT"), new v2.InMemoryIntelligenceV2Repository(), "icp-v1", { contradictoryEvidence: [conflict] });
  assert.deepEqual([result.assessment.commercialRole.value, result.assessment.who.value], ["UNKNOWN", "INSUFFICIENT_DATA"]);
});
test("Unknown/WHO", "12 optional data missing permits classification", async () => {
  const item = evidence({ primaryBusiness: "B2B SaaS", businessModel: "SAAS", geography: [{ type: "HEADQUARTERS", value: "TARGET" }] });
  const result = await run([item], assessment("POTENTIAL_BUYER", "LIKELY_FIT"));
  assert(result.profile.unknownFields.includes("employeeSize")); assert.equal(result.assessment.who.value, "LIKELY_FIT");
});
test("Evidence", "13 evidenceless model claim is rejected", () => {
  const item = evidence({ primaryBusiness: "Software" });
  const checked = v2.validateAssessmentEvidenceV2(assessment("POTENTIAL_BUYER", "LIKELY_FIT", ["nonexistent"]), [item]);
  assert.equal(checked.ok, false);
  const valid = assessment("POTENTIAL_BUYER", "LIKELY_FIT");
  valid.commercialRole.claimBindings[0].claimedValue = "Software";
  valid.who.claimBindings[0].claimedValue = "Software";
  const missingSectionClaim = structuredClone(valid);
  missingSectionClaim.commercialRole.claimIds = [];
  focused("binding must belong to section claimIds", () => assert.equal(v2.validateAssessmentEvidenceV2(missingSectionClaim, [item]).ok, false));
  const missingParentEvidence = structuredClone(valid);
  missingParentEvidence.commercialRole.evidenceIds = [];
  focused("binding parent evidence must belong to section evidenceIds", () => assert.equal(v2.validateAssessmentEvidenceV2(missingParentEvidence, [item]).ok, false));
});
test("Safety", "14 competitor overrides positive WHO", () => {
  const item = evidence({ primaryBusiness: "Substitute", offeringOverlapFacts: ["same outcome"] });
  const result = v2.applySafetyRulesV2({ profile: profile([item]), assessment: assessment("SELLER_COMPETITOR", "LIKELY_FIT"), fingerprint: "fp" });
  assert.equal(result.who.value, "LIKELY_NOT_FIT"); assert(result.deterministicOverrides.includes("COMMERCIAL_ROLE_EXCLUSION"));
});
test("Cache", "15 ICP change reruns assessment only", async () => {
  const repo = new CountingRepository();
  const item = evidence({ primaryBusiness: "B2B SaaS", businessModel: "SAAS", geography: [{ type: "HEADQUARTERS", value: "TARGET" }] });
  const mandatoryV1 = [{ criterionId: "geo", type: "GEOGRAPHY", operator: "EQUALS", value: "TARGET", mandatory: true, exclusion: false, preferred: false }];
  const mandatoryV2 = [{ criterionId: "geo", type: "GEOGRAPHY", operator: "CONTAINS", value: "TARGET", mandatory: true, exclusion: false, preferred: false }];
  await run([item], assessment("POTENTIAL_BUYER", "LIKELY_FIT"), repo, "icp-v1", {}, mandatoryV1);
  const callsBeforeAssessmentOnlyRerun = providerCalls;
  const second = await run([item], assessment("POTENTIAL_BUYER", "POSSIBLE_FIT"), repo, "icp-v2", {}, mandatoryV2);
  assert.deepEqual(second.observability.cache, { research: true, profile: true, assessment: false });
  assert.equal(second.observability.researchProviderCalls, 0); assert.equal(second.observability.modelCalls, 1);
  assert.equal(repo.researchWrites, 1); assert.equal(repo.profileWrites, 1);
  assert.equal(providerCalls, callsBeforeAssessmentOnlyRerun);
});
test("Cache/Idempotency", "16 exact request is idempotent", async () => {
  const repo = new v2.InMemoryIntelligenceV2Repository();
  const item = evidence({ primaryBusiness: "B2B SaaS", businessModel: "SAAS" });
  const first = await run([item], assessment("POTENTIAL_BUYER", "LIKELY_FIT"), repo);
  const calls = semanticCalls;
  const second = await run([item], assessment("POTENTIAL_BUYER", "LIKELY_FIT"), repo);
  assert.deepEqual(second.assessment, first.assessment); assert.deepEqual(second.observability.cache, { research: true, profile: true, assessment: true });
  assert.equal(semanticCalls, calls); assert.equal(second.observability.evidenceCount, 1);
  const beforeConcurrent = semanticCalls;
  const [left, right] = await Promise.all([
    run([item], assessment("POTENTIAL_BUYER", "LIKELY_FIT"), new v2.InMemoryIntelligenceV2Repository()),
    run([item], assessment("POTENTIAL_BUYER", "LIKELY_FIT"), new v2.InMemoryIntelligenceV2Repository()),
  ]);
  assert.deepEqual(left.assessment, right.assessment); assert.equal(semanticCalls, beforeConcurrent + 1);
});

const compactResponse = () => ({
  commercialRole: { value: "POTENTIAL_BUYER", confidence: .8, reason: "The cited business claim supports buyer capability.", citations: [{ claimId: "claim-business", relation: "SUPPORTS_ROLE" }] },
  who: { value: "POSSIBLE_FIT", confidence: .7, reason: "The cited business claim supports structural fit.", citations: [{ claimId: "claim-business", relation: "SUPPORTS_WHO" }], criteria: [] },
  uncertainties: ["Optional firmographic facts remain unknown."], assessmentConfidence: .75,
});
const directAssessment = (invoke, options = {}) => {
  const item = evidence({ primaryBusiness: "B2B SaaS" });
  return v2.assessMarketFitV2({ context: context(), profile: profile([item]), evidence: [item], invoke, ...options });
};
test("Semantic contract", "17 valid first pass materializes immutable provenance", async () => {
  let calls = 0;
  const result = await directAssessment(async () => { calls++; return { content: compactResponse(), usage: { total_tokens: 11 }, cost: .01 }; });
  assert.equal(calls, 1); assert.equal(result.modelCalls, 1); assert.equal(result.assessment.commercialRole.claimBindings[0].claimedValue, "B2B SaaS");
  assert.deepEqual(result.assessment.commercialRole.evidenceIds, [ids[0]]);
});
test("Semantic contract", "18 one validation repair succeeds with exact accounting", async () => {
  let calls = 0;
  const result = await directAssessment(async () => {
    calls++;
    const content = compactResponse();
    if (calls === 1) content.commercialRole.citations[0].claimId = "foreign-claim";
    return { content, usage: { total_tokens: calls * 10 }, cost: .01 * calls };
  });
  assert.equal(calls, 2); assert.equal(result.modelCalls, 2); assert.equal(result.usage.total_tokens, 30);
  assert.equal(result.cost, .03); assert.deepEqual(result.attempts.map((attempt) => attempt.outcome), ["INVALID", "VALID"]);
});
test("Semantic contract", "19 second invalid response rejects after exactly two calls", async () => {
  let calls = 0;
  await assert.rejects(directAssessment(async () => {
    calls++; const content = compactResponse(); content.who.citations[0].claimId = "foreign-claim"; return { content };
  }), (error) => error.code === "V2_ASSESSMENT_INVALID" && error.attempts.length === 2);
  assert.equal(calls, 2);
});
test("Semantic contract", "20 reason bounds are enforced", async () => {
  let calls = 0;
  await assert.rejects(directAssessment(async () => {
    calls++; const content = compactResponse(); content.who.reason = "x".repeat(1201); return { content };
  }), (error) => error.code === "V2_ASSESSMENT_INVALID");
  assert.equal(calls, 2);
});
test("Semantic contract", "21 timeout is typed and never retried", async () => {
  let calls = 0;
  await assert.rejects(directAssessment(async () => { calls++; return new Promise(() => {}); }, { timeoutMs: 5 }),
    (error) => error.code === "V2_ASSESSMENT_TIMEOUT" && error.attempts.length === 1 && error.attempts[0].outcome === "TIMEOUT");
  assert.equal(calls, 1);
});
test("Scope", "22 foreign seed and cached research evidence are rejected", async () => {
  const foreign = { ...evidence({ primaryBusiness: "B2B SaaS" }), organizationId: "org-foreign" };
  await assert.rejects(run([foreign]), /V2_EVIDENCE_SCOPE_MISMATCH:seed/);
  const item = evidence({ primaryBusiness: "B2B SaaS" });
  class ForeignCache extends v2.InMemoryIntelligenceV2Repository {
    async getResearch() {
      return { organizationId: "org-a", projectId: "project-a", companyId: "company-generic",
        evidence: [{ ...item, organizationId: "other" }], negativeAssertions: [], actions: [], externalCalls: 0,
        providerCost: 0, sufficient: true, fingerprint: "foreign-cache" };
    }
  }
  await assert.rejects(run([item], null, new ForeignCache()), /V2_EVIDENCE_SCOPE_MISMATCH:cached-research/);
  await assert.rejects(run([item], null, new v2.InMemoryIntelligenceV2Repository(), "icp-v1", { contradictoryEvidence: [{ ...item, evidenceId: "foreign-e", organizationId: "other" }] }), /V2_EVIDENCE_SCOPE_MISMATCH:contradictory/);
});
test("Safety", "23 all overrides produce valid final provenance", () => {
  const item = evidence({ primaryBusiness: "B2B SaaS", offeringOverlapFacts: ["same outcome"] });
  const p = profile([item]);
  const validateFinal = (final, ctx = context()) => {
    const { resolutionType, deterministicOverrides, safetyOverrideMetadata, fingerprint, ...semantic } = final;
    assert.equal(v2.validateAssessmentEvidenceV2(semantic, [item], ctx).ok, true);
    assert.equal(safetyOverrideMetadata.length > 0, true);
  };
  const competitor = assessment("SELLER_COMPETITOR", "LIKELY_FIT");
  competitor.commercialRole.reason = "The overlap is a material substitute.";
  competitor.commercialRole.claimIds = ["claim-overlap-0"]; competitor.commercialRole.evidenceIds = [ids[0]];
  competitor.commercialRole.claimBindings = [{ claimId: "claim-overlap-0", claimedValue: "same outcome", purpose: "commercialRole", relation: "MATERIAL_SUBSTITUTE" }];
  validateFinal(v2.applySafetyRulesV2({ profile: p, assessment: competitor, fingerprint: "fp" }));

  const mandatoryContext = context("icp-v1", [{ criterionId: "industry", type: "INDUSTRY", operator: "EQUALS", value: "target", mandatory: true, exclusion: false, preferred: false }]);
  const withIndustry = evidence({ primaryBusiness: "B2B SaaS" });
  withIndustry.atomicClaims.push({ claimId: "claim-industry", type: "INDUSTRY", value: "other" });
  const failed = assessment("POTENTIAL_BUYER", "LIKELY_FIT");
  failed.who.criteria = [{ criterionId: "industry", description: "INDUSTRY EQUALS target", mandatory: true, result: "FAIL", reason: "The cited industry differs.", evidenceIds: [ids[0]], claimIds: ["claim-industry"], claimBindings: [{ claimId: "claim-industry", claimedValue: "other", purpose: "industry", relation: "FAILS_CRITERION" }] }];
  const failedFinal = v2.applySafetyRulesV2({ profile: profile([withIndustry]), assessment: failed, fingerprint: "fp" });
  const { resolutionType: _r, deterministicOverrides: _d, safetyOverrideMetadata: _m, fingerprint: _f, ...failedSemantic } = failedFinal;
  assert.equal(v2.validateAssessmentEvidenceV2(failedSemantic, [withIndustry], mandatoryContext).ok, true);

  validateFinal(v2.applySafetyRulesV2({ profile: { ...p, identity: { ...p.identity, status: "IDENTITY_UNCERTAIN" } }, assessment: assessment("POTENTIAL_BUYER", "LIKELY_FIT"), fingerprint: "fp" }));
  const unsupported = assessment("POTENTIAL_BUYER", "LIKELY_FIT");
  unsupported.who.criteria = [{ criterionId: "industry", description: "INDUSTRY EQUALS target", mandatory: true, result: "PASS", reason: "Unsupported.", evidenceIds: [], claimIds: [], claimBindings: [] }];
  const unsupportedFinal = v2.applySafetyRulesV2({ profile: p, assessment: unsupported, fingerprint: "fp" });
  const { resolutionType: _r2, deterministicOverrides: _d2, safetyOverrideMetadata: _m2, fingerprint: _f2, ...unsupportedSemantic } = unsupportedFinal;
  assert.equal(v2.validateAssessmentEvidenceV2(unsupportedSemantic, [item], mandatoryContext).ok, true);
});

const geoRequirement = { criterionId: "geo", type: "GEOGRAPHY", operator: "EQUALS", value: "TARGET", mandatory: true, exclusion: false, preferred: false };
const criterionResponse = (citations) => {
  const content = compactResponse();
  content.who.criteria = [{
    criterionId: "geo", result: "PASS", confidence: .8,
    reason: "The cited claim satisfies the configured geography criterion.", citations,
  }];
  return content;
};
test("Citation normalization", "24 wrong-type-only criterion deterministically abstains", async () => {
  const item = evidence({ primaryBusiness: "B2B SaaS", geography: [{ type: "HEADQUARTERS", value: "TARGET" }] });
  const result = await v2.assessMarketFitV2({
    context: context("icp-v1", [geoRequirement]), profile: profile([item]), evidence: [item],
    invoke: async () => ({ content: criterionResponse([{ claimId: "claim-business", relation: "SATISFIES_CRITERION" }]) }),
  });
  assert.equal(result.modelCalls, 1);
  assert.equal(result.assessment.who.criteria[0].result, "UNKNOWN");
  assert.deepEqual(result.assessment.who.criteria[0].claimBindings, []);
  assert.deepEqual(result.assessment.who.criteria[0].claimIds, []);
  assert.deepEqual(result.assessment.who.criteria[0].evidenceIds, []);
  assert.match(result.assessment.who.criteria[0].reason, /required evidence type/);
});
test("Citation normalization", "25 mixed valid and wrong-type criterion keeps only exact type", async () => {
  const item = evidence({ primaryBusiness: "B2B SaaS", geography: [{ type: "HEADQUARTERS", value: "TARGET" }] });
  const result = await v2.assessMarketFitV2({
    context: context("icp-v1", [geoRequirement]), profile: profile([item]), evidence: [item],
    invoke: async () => ({ content: criterionResponse([
      { claimId: "claim-business", relation: "SATISFIES_CRITERION" },
      { claimId: "claim-geo-0", relation: "SATISFIES_CRITERION" },
    ]) }),
  });
  assert.equal(result.assessment.who.criteria[0].result, "PASS");
  assert.deepEqual(result.assessment.who.criteria[0].claimIds, ["claim-geo-0"]);
  assert.deepEqual(result.assessment.who.criteria[0].evidenceIds, [ids[0]]);
  assert.deepEqual(result.assessment.who.criteria[0].claimBindings.map((binding) => binding.claimId), ["claim-geo-0"]);
});
test("Citation normalization", "26 unknown criterion claim remains a hard error after two attempts", async () => {
  const item = evidence({ primaryBusiness: "B2B SaaS", geography: [{ type: "HEADQUARTERS", value: "TARGET" }] });
  let calls = 0;
  await assert.rejects(v2.assessMarketFitV2({
    context: context("icp-v1", [geoRequirement]), profile: profile([item]), evidence: [item],
    invoke: async () => {
      calls++;
      return { content: criterionResponse([{ claimId: "unknown-criterion-claim", relation: "SATISFIES_CRITERION" }]) };
    },
  }), (error) => error.code === "V2_ASSESSMENT_INVALID" && /unknown cited claimId/.test(error.message));
  assert.equal(calls, 2);
});
test("Cache/Citation normalization", "27 cached wrong-type criterion is normalized before validation", async () => {
  const item = evidence({ primaryBusiness: "B2B SaaS", geography: [{ type: "HEADQUARTERS", value: "TARGET" }] });
  const cached = assessment("POTENTIAL_BUYER", "POSSIBLE_FIT");
  cached.commercialRole.claimBindings[0].claimedValue = "B2B SaaS";
  cached.who.claimBindings[0].claimedValue = "B2B SaaS";
  cached.who.criteria = [{
    criterionId: "geo", description: "GEOGRAPHY EQUALS TARGET", mandatory: true, result: "PASS", confidence: .8,
    reason: "Wrong type.", evidenceIds: [ids[0]], claimIds: ["claim-business"],
    claimBindings: [{ claimId: "claim-business", claimedValue: "B2B SaaS", purpose: "geo", relation: "SATISFIES_CRITERION" }],
  }];
  class WrongTypeAssessmentCache extends v2.InMemoryIntelligenceV2Repository {
    async getAssessment() { return structuredClone(cached); }
  }
  const result = await run([item], null, new WrongTypeAssessmentCache(), "icp-v1", {}, [geoRequirement]);
  assert.equal(result.observability.cache.assessment, true);
  assert.equal(result.observability.modelCalls, 0);
  assert.equal(result.assessment.who.criteria[0].result, "UNKNOWN");
  assert.deepEqual(result.assessment.who.criteria[0].claimBindings, []);
});
test("Safety/Citation normalization", "28 normalized assessment remains valid after safety override", () => {
  const item = evidence({ primaryBusiness: "B2B SaaS", geography: [{ type: "HEADQUARTERS", value: "TARGET" }] });
  const semantic = assessment("POTENTIAL_BUYER", "LIKELY_FIT");
  semantic.commercialRole.claimBindings[0].claimedValue = "B2B SaaS";
  semantic.who.claimBindings[0].claimedValue = "B2B SaaS";
  semantic.who.criteria = [{
    criterionId: "geo", description: "GEOGRAPHY EQUALS TARGET", mandatory: true, result: "PASS", confidence: .8,
    reason: "Wrong type.", evidenceIds: [ids[0]], claimIds: ["claim-business"],
    claimBindings: [{ claimId: "claim-business", claimedValue: "B2B SaaS", purpose: "geo", relation: "SATISFIES_CRITERION" }],
  }];
  const normalized = v2.normalizeAssessmentEvidenceV2(semantic, [item], context("icp-v1", [geoRequirement]));
  const final = v2.applySafetyRulesV2({ profile: { ...profile([item]), identity: { ...profile([item]).identity, status: "IDENTITY_UNCERTAIN" } }, assessment: normalized, fingerprint: "fp" });
  const { resolutionType, deterministicOverrides, safetyOverrideMetadata, fingerprint, ...finalSemantic } = final;
  assert.equal(v2.validateAssessmentEvidenceV2(finalSemantic, [item], context("icp-v1", [geoRequirement])).ok, true);
});
test("CommercialRole/Citation normalization", "29 relation and claim type mismatch abstains", () => {
  const item = evidence({ primaryBusiness: "B2B SaaS" });
  const semantic = assessment("POTENTIAL_BUYER", "POSSIBLE_FIT");
  semantic.commercialRole.claimBindings[0] = {
    claimId: "claim-business", claimedValue: "B2B SaaS", purpose: "commercialRole", relation: "MATERIAL_SUBSTITUTE",
  };
  const normalized = v2.normalizeAssessmentEvidenceV2(semantic, [item], context());
  assert.equal(normalized.commercialRole.value, "UNKNOWN");
  assert.deepEqual([normalized.commercialRole.evidenceIds, normalized.commercialRole.claimIds, normalized.commercialRole.claimBindings], [[], [], []]);
  assert.match(normalized.commercialRole.reason, /compatible role relation and evidence type/);
});
test("CommercialRole/Citation normalization", "30 competitor without material substitute abstains", () => {
  const item = evidence({ primaryBusiness: "Substitute", offeringOverlapFacts: ["same outcome"] });
  const semantic = assessment("SELLER_COMPETITOR", "POSSIBLE_FIT");
  semantic.commercialRole.claimIds = ["claim-overlap-0"];
  semantic.commercialRole.claimBindings = [{
    claimId: "claim-overlap-0", claimedValue: "same outcome", purpose: "commercialRole", relation: "SUPPORTS_ROLE",
  }];
  const normalized = v2.normalizeAssessmentEvidenceV2(semantic, [item], context());
  assert.equal(normalized.commercialRole.value, "UNKNOWN");
  assert.deepEqual([normalized.commercialRole.evidenceIds, normalized.commercialRole.claimIds, normalized.commercialRole.claimBindings], [[], [], []]);
  assert.match(normalized.commercialRole.reason, /material substitute/);
});
test("CommercialRole/Citation normalization", "31 material substitute competitor remains safety-valid", () => {
  const item = evidence({ primaryBusiness: "Substitute", offeringOverlapFacts: ["same outcome"] });
  const semantic = assessment("SELLER_COMPETITOR", "LIKELY_FIT");
  semantic.commercialRole.claimIds = ["claim-overlap-0"];
  semantic.commercialRole.claimBindings = [{
    claimId: "claim-overlap-0", claimedValue: "same outcome", purpose: "commercialRole", relation: "MATERIAL_SUBSTITUTE",
  }];
  const normalized = v2.normalizeAssessmentEvidenceV2(semantic, [item], context());
  assert.equal(normalized.commercialRole.value, "SELLER_COMPETITOR");
  const final = v2.applySafetyRulesV2({ profile: profile([item]), assessment: normalized, fingerprint: "fp" });
  assert.equal(final.who.value, "LIKELY_NOT_FIT");
  const { resolutionType, deterministicOverrides, safetyOverrideMetadata, fingerprint, ...finalSemantic } = final;
  assert.equal(v2.validateAssessmentEvidenceV2(finalSemantic, [item], context()).ok, true);
});
test("CommercialRole/Citation normalization", "32 mixed bindings retain only compatible provenance", () => {
  const item = evidence({ primaryBusiness: "B2B SaaS", offeringOverlapFacts: ["related outcome"] });
  const semantic = assessment("ADJACENT_VENDOR", "POSSIBLE_FIT");
  semantic.commercialRole.claimIds = ["claim-business", "claim-overlap-0"];
  semantic.commercialRole.claimBindings = [
    { claimId: "claim-business", claimedValue: "B2B SaaS", purpose: "commercialRole", relation: "MATERIAL_SUBSTITUTE" },
    { claimId: "claim-overlap-0", claimedValue: "related outcome", purpose: "commercialRole", relation: "COMPLEMENTARY" },
  ];
  const normalized = v2.normalizeAssessmentEvidenceV2(semantic, [item], context());
  assert.equal(normalized.commercialRole.value, "ADJACENT_VENDOR");
  assert.deepEqual(normalized.commercialRole.claimIds, ["claim-overlap-0"]);
  assert.deepEqual(normalized.commercialRole.evidenceIds, [ids[0]]);
  assert.deepEqual(normalized.commercialRole.claimBindings, [semantic.commercialRole.claimBindings[1]]);
});
test("CommercialRole/Citation normalization", "33 unknown IDs and claimed-value mismatch remain hard failures", () => {
  const item = evidence({ primaryBusiness: "B2B SaaS" });
  const unknown = assessment("POTENTIAL_BUYER", "POSSIBLE_FIT");
  unknown.commercialRole.claimBindings[0].claimId = "forged-claim";
  assert.throws(() => v2.normalizeAssessmentEvidenceV2(unknown, [item], context()), /unknown claim/);
  const mismatch = assessment("POTENTIAL_BUYER", "POSSIBLE_FIT");
  mismatch.commercialRole.claimBindings[0] = {
    claimId: "claim-business", claimedValue: "forged value", purpose: "commercialRole", relation: "MATERIAL_SUBSTITUTE",
  };
  assert.throws(() => v2.normalizeAssessmentEvidenceV2(mismatch, [item], context()), /binding value does not match claim/);
});

for (const item of tests) await item.fn();
const categories = Object.fromEntries([...new Set(tests.map((item) => item.category))].map((category) => [category, tests.filter((item) => item.category === category).length]));
console.log(`PASS ${tests.length}/${tests.length} Task 117 generic fixtures; external calls: 0; categories: ${JSON.stringify(categories)}; focused assertions: ${JSON.stringify(focusedAssertions)}`);