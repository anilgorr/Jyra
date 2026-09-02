import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const output = "/tmp/jyra-task-107-commercial-role.cjs";
await build({ entryPoints: ["./scripts/task-107-commercial-role-test-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const lib = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const evidenceId = "11111111-1111-4111-8111-111111111111";
const evidence = [{ id: evidenceId, sourceType: "COMPANY_PROFILE_RESOLUTION", sourceUrl: null, text: "Evidence-backed primary business.", fields: ["description"] }];
const base = {
  primary_business: "Evidence-backed primary business.",
  business_model: "PROFESSIONAL_SERVICES",
  canonical_industry: "PROFESSIONAL_SERVICES",
  products_services: ["Primary service"],
  confidence: 0.8,
  reason: "Candidate and seller offerings were compared using supplied evidence.",
  evidence_ids: [evidenceId],
  missing_information: [],
};
const validRole = (commercial_role) => lib.validateSemanticOutput({ ...base, commercial_role }, evidence, "seller-fingerprint");
const fingerprintInput = {
  projectId: "project", companyId: "company", sellerContextFingerprint: "seller-a",
  canonicalName: "Candidate", canonicalDomain: "candidate.example", evidence,
};

const checks = [
  ["same ICP is not competition", () => assert.match(lib.COMPANY_SEMANTIC_SYSTEM_PROMPT, /Shared industry, customer segment, workflow, technology, or vocabulary is not competition/)],
  ["direct substitutes permit competitor", () => assert.equal(validRole("SELLER_COMPETITOR").ok, true)],
  ["B2B vendor can be buyer", () => { assert.match(lib.COMPANY_SEMANTIC_SYSTEM_PROMPT, /may sell products or services and still be a buyer/); assert.equal(validRole("POTENTIAL_BUYER").ok, true); }],
  ["complementary vendor remains supported", () => assert.equal(validRole("ADJACENT_VENDOR").ok, true)],
  ["partner requires affirmative evidence", () => assert.match(lib.COMPANY_SEMANTIC_SYSTEM_PROMPT, /PARTNER_POSSIBLE means affirmative evidence supports/)],
  ["minor feature overlap is insufficient", () => assert.match(lib.COMPANY_SEMANTIC_SYSTEM_PROMPT, /Weight primary commercial activity over minor feature overlap/)],
  ["industry alone is insufficient", () => assert.match(lib.COMPANY_SEMANTIC_SYSTEM_PROMPT, /Shared industry/)],
  ["unknown remains supported", () => assert.equal(validRole("UNKNOWN").ok, true)],
  ["substitutability is explicit", () => assert.match(lib.COMPANY_SEMANTIC_SYSTEM_PROMPT, /material substitute.*same purchasing decision/)],
  ["provenance rejects fabricated evidence", () => assert.equal(lib.validateSemanticOutput({ ...base, commercial_role: "POTENTIAL_BUYER", evidence_ids: ["22222222-2222-4222-8222-222222222222"] }, evidence, "seller-fingerprint").ok, false)],
  ["same inputs and policy are idempotent", () => assert.equal(lib.semanticFingerprint(fingerprintInput), lib.semanticFingerprint(fingerprintInput))],
  ["seller offering change invalidates relationship", () => assert.notEqual(lib.semanticFingerprint(fingerprintInput), lib.semanticFingerprint({ ...fingerprintInput, sellerContextFingerprint: "seller-b" }))],
];

for (const [, check] of checks) check();
console.log(`PASS ${checks.length}/${checks.length} Task 107 commercial relationship checks`);