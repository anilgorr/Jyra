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
console.log("PASS minimum-company-intelligence policy, no-call, bounds, and role-stop coverage");