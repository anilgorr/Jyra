import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const output = "/tmp/jyra-company-assessment-readiness.cjs";
await build({ entryPoints: ["./scripts/company-assessment-readiness-test-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const lib = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);
const id = "11111111-1111-4111-8111-111111111111";
const blankProfile = { companyId: "22222222-2222-4222-8222-222222222222", primaryBusinessDescription: null, productsServices: [], employeesExact: null, employeesMin: null, employeesMax: null, country: null, countryIso2: null, provenance: { primaryBusinessDescription: null } };
const evidence = (field, text) => [{ id, sourceType: "JYRA_DISCOVERY", sourceUrl: "https://example.test", text, fields: [field] }];
const ready = (profile, rows, identitySafe = true, mciSufficient = true) =>
  lib.companyAssessmentReadiness({ identitySafe, mciSufficient, profile: { ...blankProfile, ...profile }, evidence: rows });

const checks = [
  ["ready with primary business", () => assert.equal(ready({}, evidence("description", "Provides outsourced accounting services to small businesses.")).ready, true)],
  ["ready with service page", () => assert.equal(ready({}, evidence("searchResultExcerpt", "We design and install commercial solar power systems.")).ready, true)],
  ["ambiguous identity blocked", () => assert.deepEqual(ready({}, evidence("description", "Provides logistics software to manufacturers."), false).blockingReasons, ["IDENTITY_PERMISSION_INSUFFICIENT"])],
  ["no primary business blocked", () => assert.equal(ready({}, [{ ...evidence("title", "Example Holdings Incorporated")[0] }]).ready, false)],
  ["unknown optional fields non-blocking", () => { const result = ready({ productsServices: ["workflow automation"] }, evidence("description", "Builds workflow automation software for finance teams.")); assert.equal(result.ready, true); assert.ok(result.missingNonBlockingFields.includes("geography")); }],
  ["conflicting identity remains blocked", () => assert.equal(ready({}, evidence("description", "Operates an industrial equipment marketplace."), false).ready, false)],
  ["no evidence fabrication", () => { const rows = lib.buildCandidateEvidence(blankProfile, [{ id, sourceType: "JYRA_DISCOVERY", sourceUrl: null, payload: { description: "Manufactures precision components for medical devices.", industry: "Manufacturing" } }]); assert.doesNotMatch(rows[0].text, /geography|employee|technology|compliance|funding/i); }],
  ["unlinked MCI claim is rejected", () => { const rows = lib.buildCandidateEvidence(blankProfile, [{ id, sourceType: "MINIMUM_COMPANY_INTELLIGENCE", sourceUrl: null, payload: { claims: [{ field: "description", value: "Operates regional cold-chain logistics services.", evidenceIds: [] }] } }]); assert.equal(rows.length, 0); }],
  ["linked MCI claim retains source UUID", () => { const rows = lib.buildCandidateEvidence(blankProfile, [{ id, sourceType: "JYRA_DISCOVERY", sourceUrl: null, payload: { description: "Regional logistics operator." } }, { id: "33333333-3333-4333-8333-333333333333", sourceType: "MINIMUM_COMPANY_INTELLIGENCE", sourceUrl: null, payload: { claims: [{ field: "description", value: "Operates regional cold-chain logistics services.", evidenceIds: [id] }] } }]); assert.equal(rows.length, 1); assert.equal(rows[0].id, id); assert.match(rows[0].text, /cold-chain/); }],
  ["canonical record is explicitly referenced", () => { const profile = { ...blankProfile, primaryBusinessDescription: "Manufactures industrial temperature sensors.", provenance: { primaryBusinessDescription: { sourceType: "CANONICAL_COMPANY", sourceUrl: "https://manufacturer.test", rawValue: "Manufactures industrial temperature sensors." } } }; const rows = lib.buildCandidateEvidence(profile, []); assert.equal(rows[0].id, profile.companyId); assert.equal(rows[0].referenceKind, "CANONICAL_COMPANY"); }],
  ["idempotent fingerprint", () => { const rows = evidence("description", "Provides payroll administration services to employers."); const input = { projectId: "p", companyId: "c", sellerContextFingerprint: "s", canonicalName: "Example", canonicalDomain: "example.test", evidence: rows }; assert.equal(lib.semanticFingerprint(input), lib.semanticFingerprint(input)); }],
];
for (const [, check] of checks) check();
console.log(`PASS ${checks.length}/${checks.length} company assessment readiness checks`);