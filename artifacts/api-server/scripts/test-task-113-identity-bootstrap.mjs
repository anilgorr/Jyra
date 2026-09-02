import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

await build({
  entryPoints: ["./scripts/task-113-identity-bootstrap-test-entry.ts"],
  outfile: "/tmp/jyra-task-113-identity-bootstrap.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
});
const policy = await import(
  `${pathToFileURL("/tmp/jyra-task-113-identity-bootstrap.cjs").href}?t=${Date.now()}`
);

const upload = (domain) => ({
  sourceType: "FIRST_PARTY_UPLOAD",
  payload: { originalRow: { "Company Domain": domain } },
});
const discovery = (domain) => ({
  sourceType: "JYRA_DISCOVERY",
  payload: {
    domain,
    identityAssessment: { identityState: "PROBABLE", conflicts: [] },
    canonicalization: { researchCanonical: true },
  },
});
const resolution = (status, domain) => ({
  sourceType: status === "VERIFIED"
    ? "COMPANY_PROFILE_RESOLUTION"
    : "COMPANY_PROFILE_RESOLUTION_REVIEW",
  payload: {
    result: {
      resolutionStatus: status,
      supportingEvidence: status === "VERIFIED"
        ? [{ kind: "DOMAIN_MATCH", detail: `Official domain ${domain}` }]
        : [],
      contradictingEvidence: status === "WRONG"
        ? [{ kind: "DOMAIN_CONTRADICTION", detail: "Domain belongs to another organization" }]
        : [],
    },
  },
});

const imported = policy.deriveIdentityPermissions({
  domain: "northstar.example",
  provenance: [upload("northstar.example")],
});
assert.equal(imported.trustLevel, "RESEARCH_SAFE", "1 imported exact domain bootstraps research");
assert.equal(imported.reasonCode, "IDENTITY_RESEARCH_BOOTSTRAP_ALLOWED");

const discovered = policy.deriveIdentityPermissions({
  domain: "northstar.example",
  provenance: [discovery("northstar.example")],
});
assert.equal(discovered.trustLevel, "RESEARCH_SAFE", "2 coherent discovery candidate is research-safe");

const confirmedDiscoveryOnly = policy.deriveIdentityPermissions({
  domain: "northstar.example",
  provenance: [{
    sourceType: "JYRA_DISCOVERY",
    payload: {
      domain: "northstar.example",
      identityAssessment: { identityState: "CONFIRMED", conflicts: [] },
      canonicalization: { researchCanonical: true },
    },
  }],
});
assert.equal(
  confirmedDiscoveryOnly.trustLevel,
  "RESEARCH_SAFE",
  "confirmed discovery alone still requires independent corroboration",
);

const contradicted = policy.deriveIdentityPermissions({
  domain: "northstar.example",
  provenance: [resolution("WRONG", "other.example"), upload("northstar.example")],
});
assert.equal(contradicted.trustLevel, "UNSAFE", "3 contradictory ownership remains unsafe");

const sameNameOnly = policy.deriveIdentityPermissions({ domain: null, provenance: [] });
assert.equal(sameNameOnly.trustLevel, "UNSAFE", "4 same-name candidate without identifier is unsafe");
assert.equal(sameNameOnly.reasonCode, "DOMAIN_MISSING");

assert.equal(imported.canPublicProfileResearch, true, "5 research-safe can request public research");
assert.equal(imported.canBuildProvisionalProfile, true);

assert.equal(imported.canAttachCanonicalFacts, false, "6 research-safe cannot attach canonical facts");
assert.equal(imported.canRunCompanyUnderstanding, false);
assert.equal(imported.canRunCommercialRole, false);

assert.equal(imported.canGenerateSignals, false, "7 research-safe cannot generate downstream conclusions");
assert.equal(imported.canRankOpportunity, false);
assert.equal(imported.canEnrichContacts, false);

const corroborated = policy.deriveIdentityPermissions({
  domain: "northstar.example",
  provenance: [resolution("VERIFIED", "northstar.example"), upload("northstar.example")],
});
assert.equal(corroborated.trustLevel, "ATTRIBUTION_SAFE", "8 corroboration promotes identity");
assert.equal(corroborated.reasonCode, "VERIFIED_IDENTIFIER");

const oneSourceOnly = policy.deriveIdentityPermissions({
  domain: "northstar.example",
  provenance: [resolution("VERIFIED", "northstar.example")],
});
assert.equal(oneSourceOnly.trustLevel, "UNSAFE", "verified resolver output alone is not independent corroboration");

assert.equal(corroborated.canRunCompanyUnderstanding, true, "9 attribution-safe enables downstream intelligence");
assert.equal(corroborated.canRunCommercialRole, true);
assert.equal(corroborated.canAttachCanonicalFacts, true);

const transitionToUnsafe = policy.deriveIdentityPermissions({
  domain: "northstar.example",
  provenance: [resolution("WRONG", "other.example"), resolution("VERIFIED", "northstar.example"), upload("northstar.example")],
});
assert.equal(transitionToUnsafe.trustLevel, "UNSAFE", "10 newest contradiction revokes research permission");
assert.equal(transitionToUnsafe.canAttachCanonicalFacts, false);

const oldConflictCannotBeHidden = policy.deriveIdentityPermissions({
  domain: "northstar.example",
  provenance: [resolution("VERIFIED", "northstar.example"), resolution("WRONG", "other.example"), upload("northstar.example")],
});
assert.equal(oldConflictCannotBeHidden.trustLevel, "UNSAFE", "newer verification cannot hide a known contradiction");

assert.deepEqual(
  policy.deriveIdentityPermissions({ domain: "northstar.example", provenance: [upload("northstar.example")] }),
  policy.deriveIdentityPermissions({ domain: "northstar.example", provenance: [upload("northstar.example")] }),
  "11 repeated policy evaluation is idempotent",
);

const candidateB = policy.deriveIdentityPermissions({
  domain: "southstar.example",
  provenance: [resolution("VERIFIED", "northstar.example"), upload("northstar.example")],
});
assert.equal(candidateB.trustLevel, "UNSAFE", "12 candidate A evidence cannot satisfy candidate B");

let providerCalls = 0;
const provisionalWorkspace = new Map();
if (imported.canPublicProfileResearch) {
  providerCalls += 1;
  provisionalWorkspace.set("project-generic:candidate-northstar", [
    resolution("VERIFIED", "northstar.example"),
  ]);
}
assert.equal(providerCalls, 1, "generic integration permits one bounded normal research action");
assert.equal(imported.canAttachCanonicalFacts, false, "integration begins without attribution permission");
assert.equal(provisionalWorkspace.has("project-generic:candidate-southstar"), false, "provisional evidence is candidate-scoped");
const reassessed = policy.deriveIdentityPermissions({
  domain: "northstar.example",
  provenance: [
    ...provisionalWorkspace.get("project-generic:candidate-northstar"),
    upload("northstar.example"),
  ],
});
assert.equal(reassessed.trustLevel, "ATTRIBUTION_SAFE", "generic integration promotes only after corroboration");
assert.equal(reassessed.canRunCompanyUnderstanding, true, "generic integration unlocks downstream eligibility");

console.log("PASS Task 113 identity bootstrap: 12/12 generic cases and integration flow");