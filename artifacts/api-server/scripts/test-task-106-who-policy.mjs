import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const output = "/tmp/jyra-task-106-who-policy.cjs";
await build({ entryPoints: ["./scripts/task-106-who-policy-test-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const lib = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const evidenceId = "11111111-1111-4111-8111-111111111111";
const assessment = (buyerRole, confidence = "HIGH") => ({
  buyerRole,
  confidence,
  reason: "Evidence-backed seller-relative role.",
  sellerOffering: "Managed service",
  supportingInputs: [{ field: "website_profile", excerpt: evidenceId, source: "FIX08_COMPANY_UNDERSTANDING" }],
  assessedAt: "2026-09-02T00:00:00.000Z",
  classifierVersion: "buyer-role-resolution-06a",
});

const checks = [
  ["high-confidence competitor", () => assert.deepEqual(lib.resolveWhoFromCommercialRole(assessment("SELLER_COMPETITOR")), {
    qualification: "LIKELY_NOT_FIT", confidence: "HIGH", resolutionType: "COMMERCIAL_ROLE_EXCLUSION",
    sourceCommercialRole: "SELLER_COMPETITOR",
    reason: "The company is classified as a seller competitor for this offering and is therefore not eligible for buyer targeting.",
    evidenceIds: [evidenceId], policyVersion: lib.COMMERCIAL_ROLE_WHO_POLICY_VERSION,
  })],
  ["medium confidence inherited", () => assert.equal(lib.resolveWhoFromCommercialRole(assessment("SELLER_COMPETITOR", "MEDIUM")).confidence, "MEDIUM")],
  ["potential buyer continues normally", () => assert.equal(lib.resolveWhoFromCommercialRole(assessment("POTENTIAL_BUYER")), null)],
  ["unknown remains unresolved", () => assert.equal(lib.resolveWhoFromCommercialRole(assessment("UNKNOWN", "LOW")), null)],
  ["adjacent vendor is not forced negative", () => assert.equal(lib.resolveWhoFromCommercialRole(assessment("ADJACENT_VENDOR")), null)],
  ["partner is not forced negative", () => assert.equal(lib.resolveWhoFromCommercialRole(assessment("PARTNER_POSSIBLE")), null)],
  ["provenance is retained", () => assert.deepEqual(lib.resolveWhoFromCommercialRole(assessment("SELLER_COMPETITOR")).evidenceIds, [evidenceId])],
  ["competitor to buyer invalidates exclusion", () => assert.equal(lib.resolveWhoFromCommercialRole(assessment("POTENTIAL_BUYER")), null)],
  ["buyer to competitor creates exclusion", () => assert.equal(lib.resolveWhoFromCommercialRole(assessment("SELLER_COMPETITOR")).qualification, "LIKELY_NOT_FIT")],
  ["same input is idempotent", () => assert.deepEqual(lib.resolveWhoFromCommercialRole(assessment("SELLER_COMPETITOR")), lib.resolveWhoFromCommercialRole(assessment("SELLER_COMPETITOR")))],
  ["policy does not expose a model boundary", () => assert.equal(lib.resolveWhoFromCommercialRole.length, 1)],
];

for (const [, check] of checks) check();
console.log(`PASS ${checks.length}/${checks.length} Task 106 explicit WHO policy checks`);