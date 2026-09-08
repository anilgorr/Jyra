/**
 * The assessment retries when the model invents atomic claim IDs.
 *
 * materialize() turns an unknown citation into a safe abstention, which is the
 * right thing to persist. The cost was that the abstaining response then
 * *validated*, so the attempt-2 repair prompt never fired: two runs of the same
 * company minutes apart returned POTENTIAL_BUYER and UNKNOWN, both with
 * model_calls: 1. These suites pin the repair loop.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const v2 = await loadHermetic("./scripts/citation-repair-test-entry.ts", "/tmp/jyra-citation-repair.cjs");

const EVIDENCE = [{
  evidenceId: "ev-1", organizationId: "org-a", companyId: "company-a", projectId: "project-a",
  sourceType: "FIRST_PARTY_WEBSITE", provider: "fixture",
  url: "https://acme.example/about", finalUrl: "https://acme.example/about", title: "About Acme",
  observedAt: "2026-01-01T00:00:00.000Z", rawSnippet: "Acme runs a cloud observability platform.",
  firstParty: true, confidence: 0.9, version: "v1",
  atomicClaims: [
    { claimId: "claim-brand", type: "BRAND_MATCH", value: "Acme" },
    { claimId: "claim-business", type: "PRIMARY_BUSINESS", value: "Cloud observability platform" },
    { claimId: "claim-product", type: "PRODUCT_SERVICE", value: "Infrastructure monitoring" },
  ],
  claims: { primaryBusiness: "Cloud observability platform" },
}];

const CONTEXT = {
  organizationId: "org-a", projectId: "project-a", businessTwinVersion: "twin-v1",
  offeringVersion: "offering-v1", icpVersion: "icp-v1",
  sellerBusinessTwin: { business: "Managed SOC provider" },
  offering: { name: "Managed SOC" },
  icp: { target: "B2B software companies", geography: "TARGET", requirements: [] },
};
const PROFILE = { companyId: "company-a", identity: { companyName: "Acme", domain: "acme.example" } };

/** A model response citing whichever claim ID it is told to cite. */
const respond = (claimId) => ({
  content: {
    commercialRole: {
      value: "POTENTIAL_BUYER", confidence: 0.82,
      reason: "The cited claim shows a software business that consumes security operations.",
      citations: [{ claimId, relation: "SUPPORTS_ROLE" }],
    },
    who: {
      value: "LIKELY_FIT", confidence: 0.79,
      reason: "The cited claim shows a B2B software company.",
      citations: [{ claimId, relation: "SUPPORTS_WHO" }], criteria: [],
    },
    uncertainties: [], assessmentConfidence: 0.8,
  },
  usage: { total_tokens: 100 }, cost: 0.01,
});

const run = async (claimIdsByAttempt) => {
  const seen = [];
  const result = await v2.assessMarketFitV2({
    context: CONTEXT, profile: PROFILE, evidence: EVIDENCE,
    invoke: async (input) => {
      seen.push(input);
      return respond(claimIdsByAttempt[seen.length - 1]);
    },
  });
  return { result, seen };
};

// 1. An invented claim ID on attempt 1 costs a second call, and the repaired
//    answer is the one that survives.
{
  const { result, seen } = await run(["claim-hallucinated", "claim-business"]);
  assert.equal(result.modelCalls, 2, "an invented citation must trigger the repair attempt");
  assert.equal(result.attempts[0].outcome, "CITATION_ABSTAINED");
  assert.equal(result.attempts[1].outcome, "VALID");
  assert.equal(result.assessment.commercialRole.value, "POTENTIAL_BUYER");
  assert.equal(result.assessment.who.value, "LIKELY_FIT");
  assert.equal(result.assessment.commercialRole.claimIds[0], "claim-business");
  assert.equal(seen.length, 2);
  assert.equal(seen[1].attempt, 2);
  const repairText = JSON.stringify(seen[1].validationErrors);
  assert.match(repairText, /claim-hallucinated/, "the repair prompt must name the invented ID");
  assert.match(repairText, /commercialRole/);
  assert.match(repairText, /who/);
}

// 2. A response that cites real claims first time costs exactly one call. The
//    repair loop must not tax correct answers.
{
  const { result, seen } = await run(["claim-business"]);
  assert.equal(result.modelCalls, 1);
  assert.equal(result.attempts[0].outcome, "VALID");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].validationErrors, undefined);
}

// 3. If attempt 2 also invents an ID, the abstention stands. Failing the whole
//    assessment would lose an honest "we do not know" for a model quirk.
{
  const { result } = await run(["claim-hallucinated", "claim-also-fake"]);
  assert.equal(result.modelCalls, 2);
  assert.equal(result.attempts[1].outcome, "VALID");
  assert.equal(result.assessment.commercialRole.value, "UNKNOWN");
  assert.equal(result.assessment.who.value, "INSUFFICIENT_DATA");
  assert.equal(result.assessment.commercialRole.claimIds.length, 0);
  assert.equal(result.citationIntegrity.citationsDropped, 2);
}

// 4. Cost and usage accumulate across both calls — a repaired run is not billed
//    as if it were a single call.
{
  const { result } = await run(["claim-hallucinated", "claim-business"]);
  assert.equal(Math.round(result.cost * 100) / 100, 0.02);
  assert.equal(result.usage.total_tokens, 200);
}

// 5. A partly-invented citation does not trigger a retry: the section still
//    stands on a real claim, so only the bad citation is dropped.
{
  const seen = [];
  const result = await v2.assessMarketFitV2({
    context: CONTEXT, profile: PROFILE, evidence: EVIDENCE,
    invoke: async (input) => {
      seen.push(input);
      const base = respond("claim-business");
      base.content.commercialRole.citations = [
        { claimId: "claim-business", relation: "SUPPORTS_ROLE" },
        { claimId: "claim-ghost", relation: "SUPPORTS_ROLE" },
      ];
      return base;
    },
  });
  assert.equal(result.modelCalls, 1, "a surviving section must not be re-asked");
  assert.equal(result.assessment.commercialRole.value, "POTENTIAL_BUYER");
  assert.equal(result.citationIntegrity.citationsDropped, 1);
  assert.deepEqual(result.citationIntegrity.droppedClaimIds, ["claim-ghost"]);
}

// 6. Integrity counters describe the attempt that was returned, not the sum of
//    both — otherwise a repaired run reports drops it no longer contains.
{
  const { result } = await run(["claim-hallucinated", "claim-business"]);
  assert.equal(result.citationIntegrity.citationsDropped, 0);
  assert.deepEqual(result.citationIntegrity.droppedClaimIds, []);
}

console.log("PASS citation-repair");
