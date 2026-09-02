import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
await build({ entryPoints: ["./scripts/minimum-company-intelligence-policy-test-entry.ts"], outfile: "/tmp/jyra-minimum-intelligence.cjs", bundle: true, format: "cjs", platform: "node" });
const lib = await import(`${pathToFileURL("/tmp/jyra-minimum-intelligence.cjs").href}?t=${Date.now()}`);
assert.equal(lib.minimumIntelligenceSufficient({ description: "Makes industrial control equipment." }), true);
assert.equal(lib.minimumIntelligenceSufficient({ industry: "Manufacturing" }), true);
assert.equal(lib.minimumIntelligenceSufficient({ products: ["Managed detection service"] }), true);
assert.equal(lib.minimumIntelligenceSufficient({}), false);
assert.equal(lib.shouldCallMinimumIntelligenceProvider({ cacheHit: true, identitySafe: true, sufficient: false }), false, "cached evidence makes zero calls");
assert.equal(lib.shouldCallMinimumIntelligenceProvider({ cacheHit: false, identitySafe: false, sufficient: false }), false, "unsafe identity makes zero calls");
assert.equal(lib.boundedProfileResolutionCalls(true, true), 2, "primary plus fallback bound");
assert.ok(lib.boundedProfileResolutionCalls(true, true) <= 2);
assert.equal(lib.researchStopCode("UNKNOWN"), "STILL_UNKNOWN");
assert.equal(lib.researchStopCode("POTENTIAL_BUYER"), null);
assert.equal(lib.researchStopCode("SELLER_COMPETITOR"), "NON_BUYER");
assert.equal(lib.researchStopCode("UNKNOWN", false), "UNSAFE_IDENTITY");
const probable = lib.deriveIdentityPermissions({ domain: "buyer.example", provenance: [{
  sourceType: "JYRA_DISCOVERY",
  payload: {
    domain: "buyer.example",
    identityAssessment: { identityState: "PROBABLE", conflicts: [] },
    canonicalization: { researchCanonical: true },
  },
}] });
assert.equal(probable.trustLevel, "RESEARCH_SAFE");
assert.equal(probable.canPublicProfileResearch, true);
assert.equal(probable.canAttachCanonicalFacts, false);
assert.equal(probable.canRunCompanyUnderstanding, false, "research permission is not attribution permission");
assert.equal(probable.canRunCommercialRole, false, "research-safe cannot skip identity corroboration");
const conflicting = lib.deriveIdentityPermissions({ domain: "buyer.example", provenance: [{
  sourceType: "JYRA_DISCOVERY",
  payload: {
    domain: "buyer.example",
    identityAssessment: { identityState: "AMBIGUOUS", conflicts: ["domain conflict"] },
    canonicalization: { researchCanonical: false },
  },
}] });
assert.equal(conflicting.trustLevel, "UNSAFE");
assert.equal(conflicting.canPublicProfileResearch, false);
const profile = {
  canonicalName: "Buyer Co",
  domain: "buyer.example",
  primaryBusinessDescription: "Makes industrial control equipment.",
  canonicalIndustry: "MANUFACTURING",
};
const legacyAssessment = {
  buyerRole: "POTENTIAL_BUYER",
  confidence: "HIGH",
  reason: "Operating manufacturer",
  sellerOffering: "Managed SOC",
  supportingInputs: [{ field: "description", excerpt: "industrial control equipment", source: "canonical_company" }],
  assessedAt: "2026-09-02T00:00:00.000Z",
  classifierVersion: "buyer-role-resolution-06a",
};
assert.equal(lib.assessmentFreshness({
  assessment: legacyAssessment,
  buyerRole: "POTENTIAL_BUYER",
  fingerprint: "current",
  sellerOffering: "Managed SOC",
  profile,
}), "STALE", "legacy role without an exact context fingerprint must be reassessed");
assert.equal(lib.assessmentFreshness({
  assessment: { ...legacyAssessment, controlPlaneFingerprint: "current", controlPlaneVersion: lib.COMPANY_INTELLIGENCE_CONTROL_PLANE_VERSION },
  buyerRole: "POTENTIAL_BUYER",
  fingerprint: "current",
  sellerOffering: "Managed SOC",
  profile,
}), "FRESH", "exact current fingerprint is reused");
assert.equal(lib.assessmentFreshness({
  assessment: legacyAssessment,
  buyerRole: "POTENTIAL_BUYER",
  fingerprint: "changed",
  sellerOffering: "AEO Platform",
  profile,
}), "STALE", "seller-context changes invalidate the role");
assert.equal(lib.assessmentFreshness({
  assessment: { ...legacyAssessment, buyerRole: "UNKNOWN", controlPlaneFingerprint: "current", controlPlaneVersion: lib.COMPANY_INTELLIGENCE_CONTROL_PLANE_VERSION },
  buyerRole: "UNKNOWN",
  fingerprint: "current",
  sellerOffering: "Managed SOC",
  profile,
}), "STALE", "UNKNOWN is unresolved state, never a fresh terminal role");
console.log("PASS minimum-company-intelligence policy, no-call, bounds, and role-stop coverage");