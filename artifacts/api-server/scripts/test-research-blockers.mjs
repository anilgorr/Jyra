/**
 * What stops research for a project. The launch pool's ICP was saved against
 * Business Twin v1 after v2 existed, and every scheduled cycle was skipped for
 * four days with nothing on screen to say so. The cycle and the banner now
 * read one function, so they cannot disagree.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const m = await loadHermetic("./scripts/research-blockers-test-entry.ts", "/tmp/jyra-research-blockers-test.cjs");

const ready = {
  businessTwinReady: true, offeringReady: true, icpReady: true,
  businessTwinVersionId: "t2", icpVersionId: "i10", missingRequirements: ["OPPORTUNITY_PACK_MISSING"],
};
assert.deepEqual(m.researchBlockers(ready), [], "a missing opportunity pack does not stop research");

assert.deepEqual(
  m.researchBlockers({ ...ready, icpReady: false, missingRequirements: ["ICP_NOT_LINKED_TO_BUSINESS_TWIN", "OPPORTUNITY_PACK_MISSING"] }),
  ["ICP_NOT_LINKED_TO_BUSINESS_TWIN"],
  "an ICP built from an older Twin stops research, and says why",
);
assert.deepEqual(m.researchBlockers({ ...ready, icpVersionId: null, missingRequirements: [] }), ["SELLER_CONTEXT_INCOMPLETE"],
  "a stop is never reported with no reason");

// End to end through the readiness evaluation, with the launch pool's shape.
const twin = (id, version) => ({ id, businessTwinId: "bt", version, status: "ready", createdAt: new Date(),
  rawAnswers: { companyName: "Apollo.io", offeringName: "Sales Intelligence Platform", website: "https://www.apollo.io",
    industry: "Sales technology", productDescription: "Sales intelligence and engagement platform for B2B revenue teams." },
  aiInterpretation: {}, manualInterpretation: null });
const icp = (id, sourceTwin) => ({ id, icpId: "icp", version: 6, createdAt: new Date(), sourceBusinessTwinVersionId: sourceTwin });
const stale = m.evaluateProjectReadiness({ projectId: "p", organizationId: "o", twin: twin("t2", 2), icp: icp("i6", "t1") });
assert.ok(m.researchBlockers(stale).includes("ICP_NOT_LINKED_TO_BUSINESS_TWIN"));
const fixed = m.evaluateProjectReadiness({ projectId: "p", organizationId: "o", twin: twin("t2", 2), icp: icp("i10", "t2") });
assert.ok(fixed.offeringReady, `offering: ${JSON.stringify(fixed.sufficiency)}`);
assert.deepEqual(m.researchBlockers(fixed), [], "an ICP rebuilt from the current Twin resumes research");

console.log("research blockers: ok");
