import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

if (process.env.JYRA_V2_LIVE_SEMANTIC_PROBE !== "YES") {
  throw new Error("Live probe disabled. Set JYRA_V2_LIVE_SEMANTIC_PROBE=YES explicitly.");
}

const output = "/tmp/jyra-task-117-live-semantic-probe.cjs";
await build({ entryPoints: ["./scripts/task-117-live-semantic-probe-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const v2 = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const evidence = [{
  evidenceId: "synthetic-evidence-1", organizationId: "synthetic-org", projectId: "synthetic-project", companyId: "synthetic-company",
  sourceType: "SYNTHETIC_CONTRACT_PROBE", provider: "local-contract-probe",
  url: null, finalUrl: null, title: "Synthetic company facts", observedAt: "2026-01-01T00:00:00.000Z",
  rawSnippet: "Synthetic Company sells B2B workflow software and is headquartered in the target market.",
  firstParty: true, confidence: .99, version: "synthetic-v1",
  atomicClaims: [
    { claimId: "synthetic-business", type: "PRIMARY_BUSINESS", value: "B2B workflow software" },
    { claimId: "synthetic-geography", type: "GEOGRAPHY", value: "TARGET", geographyType: "HEADQUARTERS" },
  ],
  claims: { primaryBusiness: "B2B workflow software", geography: [{ type: "HEADQUARTERS", value: "TARGET" }] },
}];
const identity = {
  status: "RESOLVED", confidence: .99, reason: "Synthetic probe identity.",
  evidenceIds: ["synthetic-evidence-1"], normalizedCompanyName: "Synthetic Company",
  normalizedDomain: null, normalizedUrl: null,
};
const profile = v2.buildCompanyProfileV2({
  organizationId: "synthetic-org", projectId: "synthetic-project", companyId: "synthetic-company",
  identity, evidence, now: new Date("2026-01-01T00:00:00.000Z"),
});
const context = {
  organizationId: "synthetic-org", projectId: "synthetic-project",
  businessTwinVersion: "synthetic-twin-v1", offeringVersion: "synthetic-offering-v1", icpVersion: "synthetic-icp-v1",
  sellerBusinessTwin: { primaryBusiness: "Managed workflow optimization consultancy" },
  offering: { name: "Workflow optimization service", materialCapabilities: ["workflow optimization"] },
  icp: { requirements: [{ criterionId: "hq-target", type: "GEOGRAPHY", operator: "EQUALS", value: "TARGET", mandatory: true, exclusion: false, preferred: false }] },
};

const result = await v2.assessMarketFitV2({ context, profile, evidence });
assert(result.modelCalls >= 1 && result.modelCalls <= 2);
assert.equal(result.assessment.who.criteria[0]?.criterionId, "hq-target");
console.log(JSON.stringify({
  ok: true, commercialRole: result.assessment.commercialRole.value, who: result.assessment.who.value,
  modelCalls: result.modelCalls, attempts: result.attempts.map(({ attempt, outcome, durationMs }) => ({ attempt, outcome, durationMs })),
  usage: result.usage, cost: result.cost,
}, null, 2));