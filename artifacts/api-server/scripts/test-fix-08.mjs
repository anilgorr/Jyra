import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

// The pure test seam never invokes the client; dummy values only permit loading
// the configured SDK module bundled by the semantic implementation.
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const output = "/tmp/jyra-fix-08.cjs";
await build({ entryPoints: ["./scripts/fix-08-test-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const lib = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);
const twin = { id: "twin-version", businessTwinId: "twin", rawAnswers: { offeringName: "the seller offering", offeringDescription: "placeholder", companyName: "Seller" }, aiInterpretation: {}, manualInterpretation: {} };
const pack = { id: "pack", offeringKey: "managed-soc" };
const packVersion = { id: "pv", offeringSnapshot: { name: "Managed SOC", category: "Cybersecurity", description: "24/7 managed detection and response", capabilities: ["monitoring"] } };
const seller = lib.assembleSellerContext({ twin, icp: { id: "icp" }, pack, packVersion });
const fallback = lib.assembleSellerContext({ twin: { ...twin, rawAnswers: { offeringName: "Recruitment services", offeringDescription: "Permanent hiring" } }, icp: { id: "icp" } });
const profile = { canonicalName: "Acme Bank", website: "https://acme.example", primaryBusinessDescription: "Retail bank serving consumers.", canonicalIndustry: "Financial Services", productsServices: ["commercial lending"] };
const evidence = lib.buildCandidateEvidence(profile, [{ id: "11111111-1111-4111-8111-111111111111", sourceType: "JYRA_DISCOVERY", sourceUrl: "https://acme.example", payload: { description: "Retail bank serving consumers." } }, { id: "22222222-2222-4222-8222-222222222222", sourceType: "WHEN_WHY_RESEARCH", sourceUrl: null, payload: { description: "must never appear" } }]);
const valid = { primary_business: "Retail bank serving consumers.", business_model: "FINANCIAL_INSTITUTION", canonical_industry: "FINANCIAL_SERVICES", products_services: ["commercial lending"], commercial_role: "POTENTIAL_BUYER", confidence: .9, reason: "It operates a bank.", evidence_ids: [evidence[0].id], missing_information: [] };
const checks = [
  ["activated pack precedence", () => assert.equal(seller.offeringName, "Managed SOC")],
  ["Business Twin fallback", () => assert.equal(fallback.offeringName, "Recruitment services")],
  ["generic placeholder rejection", () => assert.equal(lib.sellerContextSufficiency(lib.assembleSellerContext({ twin })).sufficient, false)],
  ["strict schemas and enums", () => { assert.equal(lib.companySemanticOutputSchema.safeParse({ ...valid, business_model: "INVENTED" }).success, false); assert.equal(lib.companySemanticOutputSchema.safeParse({ ...valid, canonical_industry: "ARBITRARY_INDUSTRY" }).success, false); }],
  ["fabricated evidence rejected", () => assert.equal(lib.validateSemanticOutput({ ...valid, evidence_ids: ["00000000-0000-4000-8000-000000000000"] }, evidence, seller.fingerprint).ok, false)],
  ["foreign evidence rejected", () => { const foreign = lib.buildCandidateEvidence({ ...profile, canonicalName: "Other Co", primaryBusinessDescription: "Other business." }, [{ id: "33333333-3333-4333-8333-333333333333", sourceType: "JYRA_DISCOVERY", sourceUrl: null, payload: { description: "Other business." } }]); assert.equal(lib.validateSemanticOutput({ ...valid, evidence_ids: [foreign[0].id] }, evidence, seller.fingerprint).ok, false); }],
  ["non UNKNOWN requires citation", () => assert.equal(lib.validateSemanticOutput({ ...valid, evidence_ids: [] }, evidence, seller.fingerprint).ok, false)],
  ["low confidence fails closed", () => assert.deepEqual(lib.validateSemanticOutput({ ...valid, confidence: .2 }, evidence, seller.fingerprint), { ok: false, reason: "LLM_LOW_CONFIDENCE" })],
  ["WHEN WHY excluded", () => assert.equal(evidence.some((item) => item.text.includes("must never")), false)],
  ["profile resolution excerpts are citable", () => { const profileEvidence = lib.buildCandidateEvidence(profile, [{ id: "44444444-4444-4444-8444-444444444444", sourceType: "COMPANY_PROFILE_RESOLUTION", sourceUrl: "https://acme.example/about", payload: { result: { candidates: [{ title: "Acme Bank", searchResultExcerpt: "Acme is a retail bank." }] } } }]); assert.equal(profileEvidence[0]?.id, "44444444-4444-4444-8444-444444444444"); assert.match(profileEvidence[0]?.text ?? "", /retail bank/i); }],
  ["replay allows explicit disabled reality contacts only", () => { assert.equal(lib.fix08ReplayEnvironmentAllowed({ JYRA_REALITY_CONTACT_ENRICHMENT_ENABLED: "false" }), true); assert.equal(lib.fix08ReplayEnvironmentAllowed({ JYRA_REALITY_CONTACT_ENRICHMENT_ENABLED: "true" }), false); assert.equal(lib.fix08ReplayEnvironmentAllowed({ JYRA_REALITY_TEST_NAME: "test" }), false); }],
  ["fingerprint stable", () => assert.equal(lib.semanticFingerprint({ projectId: "p", companyId: "c", sellerContextFingerprint: seller.fingerprint, evidence }), lib.semanticFingerprint({ projectId: "p", companyId: "c", sellerContextFingerprint: seller.fingerprint, evidence: [...evidence].reverse() }))],
  ["seller/evidence/model/prompt invalidate cache", () => { const base = lib.semanticFingerprint({ projectId: "p", companyId: "c", sellerContextFingerprint: seller.fingerprint, evidence }); for (const changed of [{ sellerContextFingerprint: "other" }, { evidence: [...evidence, { ...evidence[0], id: "ev_1111111111111111" }] }, { model: "other" }, { promptVersion: "other" }]) assert.notEqual(base, lib.semanticFingerprint({ projectId: "p", companyId: "c", sellerContextFingerprint: seller.fingerprint, evidence, ...changed })); }],
  ["project relative cache keys", () => assert.notEqual(lib.semanticFingerprint({ projectId: "project-a", companyId: "c", sellerContextFingerprint: seller.fingerprint, evidence }), lib.semanticFingerprint({ projectId: "project-b", companyId: "c", sellerContextFingerprint: seller.fingerprint, evidence }))],
  ["cross industry evidence backed", () => {
    const examples = [["Bank", "Retail bank providing deposits.", "POTENTIAL_BUYER"], ["MSSP", "24/7 managed SOC provider.", "SELLER_COMPETITOR"], ["ERP consultant", "ERP implementation consultancy.", "SELLER_COMPETITOR"], ["Factory", "Manufacturer of industrial equipment.", "POTENTIAL_BUYER"]];
    for (const [index, [name, description, role]] of examples.entries()) { const ev = lib.buildCandidateEvidence({ ...profile, canonicalName: name, primaryBusinessDescription: description }, [{ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`, sourceType: "JYRA_DISCOVERY", sourceUrl: null, payload: { description } }]); assert.equal(lib.validateSemanticOutput({ ...valid, primary_business: description, commercial_role: role, evidence_ids: [ev[0].id] }, ev, seller.fingerprint).ok, true); }
  }],
];
for (const [, check] of checks) check();
console.log(`PASS ${checks.length}/${checks.length} Fix08 focused checks`);