import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../src/routes/intelligence-v2.ts", import.meta.url), "utf8");
const spec = await readFile(new URL("../../../lib/api-spec/openapi.yaml", import.meta.url), "utf8");

// The route has no project-private legacy evidence relation. A canonical
// companyId query would allow another project's evidence to be restamped.
assert(!route.includes("companyEvidenceTable"), "V2 route must not read canonical company evidence");
assert(route.includes("legacySeedEvidenceForV2()"), "V2 request must use the no-legacy-seed isolation seam");
assert(route.includes("firstPartyEvidence: legacySeedEvidenceForV2()"), "V2 must pass no cross-project legacy seed evidence");
assert(route.includes("organizationMembersTable"), "V2 route must derive membership from authenticated DB context");

// Contract parsing covers full inspection fields rather than an untyped blob.
for (const required of ["IntelligenceV2Criterion", "claimBindings", "deterministicOverrides", "resolutionType", "LIKELY_FIT", "SELLER_COMPETITOR"]) {
  assert(spec.includes(required), `V2 OpenAPI contract is missing ${required}`);
}
console.log("PASS Task 117 V2 route contract and canonical-evidence isolation");