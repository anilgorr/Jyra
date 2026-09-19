/**
 * The seller answers "What you're compared against" and nothing read it.
 * Apollo.io named ZoomInfo, Lusha, Salesloft and Outreach; across a full
 * 119-company run all of them came back UNKNOWN, and ZoomInfo was assessed a
 * LIKELY_FIT buyer.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const n = await loadHermetic("./scripts/named-competitors-test-entry.ts", "/tmp/jyra-named-competitors.cjs");

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log(`  ok  ${name}`); };

// Verbatim from the Business Twin. The box asks for two different things:
// "Competitors, and the non-purchase alternatives (in-house, do nothing)."
const APOLLO_ANSWER = [
  "ZoomInfo", "Lusha", "Salesloft", "Outreach",
  "Building in-house lists with LinkedIn and spreadsheets",
  "Doing nothing and relying on inbound only",
].join("\n");

check("only the vendors are taken out of the box, not the alternatives", () => {
  assert.deepEqual(n.sellerNamedCompetitors(APOLLO_ANSWER), ["ZoomInfo", "Lusha", "Salesloft", "Outreach"]);
  assert.deepEqual(n.sellerNamedCompetitors(""), []);
  assert.deepEqual(n.sellerNamedCompetitors(null), []);
  assert.deepEqual(n.sellerNamedCompetitors("Manual spreadsheets\nStatus quo\nNo vendor at all"), [],
    "a behaviour is not a vendor");
  assert.deepEqual(n.sellerNamedCompetitors("ZoomInfo, Lusha; Outreach"), ["ZoomInfo", "Lusha", "Outreach"],
    "commas and semicolons separate as newlines do");
  assert.deepEqual(n.sellerNamedCompetitors("ZoomInfo\nzoominfo\nZoomInfo Inc"), ["ZoomInfo"],
    "the same name twice is once, and the normalizer already folds the legal form in");
});

check("matching is stricter than elsewhere, because a false match deletes a prospect", () => {
  assert.equal(n.matchesNamedCompetitor("ZoomInfo", "ZoomInfo"), true);
  assert.equal(n.matchesNamedCompetitor("ZoomInfo Technologies", "ZoomInfo"), true, "a corporate form still matches");
  assert.equal(n.matchesNamedCompetitor("Outreach", "Outreach Corporation"), true);
  // The trap the general comparison walks into.
  assert.equal(n.matchesNamedCompetitor("Front Office Sports", "Front"), false);
  assert.equal(n.matchesNamedCompetitor("Clay Networks", "Clay"), false);
  assert.equal(n.matchesNamedCompetitor("Miro", "ZoomInfo"), false);
  assert.equal(n.namedCompetitorFor("ZoomInfo", ["Lusha", "ZoomInfo"]), "ZoomInfo");
  assert.equal(n.namedCompetitorFor("Miro", ["Lusha", "ZoomInfo"]), null);
});

const PROFILE = { identity: { status: "RESOLVED", confidence: 0.9 } };

const baseAssessment = () => ({
  commercialRole: { value: "POTENTIAL_BUYER", confidence: 0.8, reason: "Looks like a buyer.",
    evidenceIds: ["ev-1"], claimIds: ["ev-1:biz"],
    claimBindings: [{ claimId: "ev-1:biz", claimedValue: "GTM platform", purpose: "ROLE", relation: "SUPPORTS_ROLE" }] },
  who: { value: "LIKELY_FIT", confidence: 0.8, reason: "Fits.", evidenceIds: ["ev-1"], claimIds: ["ev-1:biz"],
    claimBindings: [{ claimId: "ev-1:biz", claimedValue: "GTM platform", purpose: "WHO", relation: "SUPPORTS_WHO" }],
    criteria: [] },
  uncertainties: [], assessmentConfidence: 0.8,
});

check("a seller-named competitor is excluded however the model read its website", () => {
  const named = ["ZoomInfo", "Lusha", "Salesloft", "Outreach"];
  const out = n.applySafetyRulesV2({
    profile: PROFILE, assessment: baseAssessment(), fingerprint: "f",
    companyName: "ZoomInfo", namedCompetitors: named,
  });
  assert.equal(out.commercialRole.value, "SELLER_COMPETITOR");
  assert.match(out.commercialRole.reason, /named ZoomInfo as a competitor/);
  assert.equal(out.who.value, "LIKELY_NOT_FIT", "and the existing exclusion rule then fires");
  assert.match(out.who.reason, /named ZoomInfo as a competitor/);
  assert.ok(out.deterministicOverrides.includes("SELLER_NAMED_COMPETITOR"));
  assert.ok(out.deterministicOverrides.includes("COMMERCIAL_ROLE_EXCLUSION"));
  assert.deepEqual(out.commercialRole.claimBindings, baseAssessment().commercialRole.claimBindings,
    "the model's citations stay: they establish which company this is");
  assert.equal(out.safetyOverrideMetadata.find((m) => m.rule === "SELLER_NAMED_COMPETITOR").provenance, "SELLER_DECLARED");

  // A company the seller did not name is untouched.
  const buyer = n.applySafetyRulesV2({
    profile: PROFILE, assessment: baseAssessment(), fingerprint: "f",
    companyName: "Miro", namedCompetitors: named,
  });
  assert.equal(buyer.commercialRole.value, "POTENTIAL_BUYER");
  assert.equal(buyer.who.value, "LIKELY_FIT");
  assert.ok(!buyer.deterministicOverrides.includes("SELLER_NAMED_COMPETITOR"));

  // And a caller that passes nothing behaves exactly as before.
  const legacy = n.applySafetyRulesV2({ profile: PROFILE, assessment: baseAssessment(), fingerprint: "f" });
  assert.equal(legacy.commercialRole.value, "POTENTIAL_BUYER");
});

check("screening disqualifies a named competitor before any research is paid for", () => {
  const policy = {
    offering: { name: "Sales Intelligence Platform", description: null, materialCapabilities: [] },
    targetCountries: [], sellerIndustries: [],
    namedCompetitors: ["ZoomInfo", "Lusha", "Salesloft", "Outreach"],
  };
  const input = (canonicalName) => ({
    company: {
      projectCompanyId: `pc-${canonicalName}`, companyId: `c-${canonicalName}`, canonicalName,
      domain: `${canonicalName.toLowerCase()}.com`, industry: null, description: null,
      employeeCount: null, employeeRange: null, country: null,
    },
    technologies: [], activeSignals: 0,
  });
  const competitor = n.screenCompany(input("ZoomInfo"), policy);
  assert.equal(competitor.verdict, "DISQUALIFIED");
  assert.ok(competitor.disqualifiers.some((d) => /You named them as a competitor: ZoomInfo/.test(d)));
  assert.equal(n.screenCompany(input("Miro"), policy).verdict, "KEEP");
});

check("the override survives the final re-validation it originally broke", () => {
  // Clearing the citations was the first attempt, and it failed on exactly the
  // three companies the rule exists for. The orchestrator re-validates after
  // safety rules: a non-UNKNOWN role must cite something, and a SELLER_COMPETITOR
  // normally needs a MATERIAL_SUBSTITUTE binding on an OFFERING_OVERLAP claim.
  // ZoomInfo, Outreach and Salesloft all died at V2_FINAL_ASSESSMENT_INVALID.
  const evidence = [{
    evidenceId: "ev-1", organizationId: "org-a", projectId: "p", companyId: "c-zoominfo",
    sourceType: "FIRST_PARTY_WEBSITE", provider: "fixture", url: "https://zoominfo.example",
    finalUrl: "https://zoominfo.example", observedAt: "2026-09-19T00:00:00.000Z",
    rawSnippet: "ZoomInfo is a go-to-market platform.", firstParty: true, confidence: 0.9, version: "v1",
    atomicClaims: [{ claimId: "ev-1:biz", type: "PRIMARY_BUSINESS", value: "GTM platform" }],
    claims: { primaryBusiness: "ZoomInfo is a go-to-market platform." },
  }];
  const final = n.applySafetyRulesV2({
    profile: PROFILE, assessment: baseAssessment(), fingerprint: "f",
    companyName: "ZoomInfo", namedCompetitors: ["ZoomInfo"],
  });
  const { resolutionType, deterministicOverrides, safetyOverrideMetadata, fingerprint, ...semantic } = final;

  const strict = n.validateAssessmentEvidenceV2(semantic, evidence, { icp: { requirements: [] } });
  assert.equal(strict.ok, false, "without the exemption a seller-declared competitor is rejected");
  assert.ok(strict.errors.some((e) => /material-substitutability/.test(e)));

  const exempt = n.validateAssessmentEvidenceV2(semantic, evidence, { icp: { requirements: [] } },
    { sellerDeclaredCompetitor: deterministicOverrides.includes("SELLER_NAMED_COMPETITOR") });
  assert.equal(exempt.ok, true, "with it, the assessment stands");
});

console.log(`\nnamed competitors: ${checks} checks passed`);
