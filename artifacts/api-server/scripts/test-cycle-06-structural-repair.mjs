import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-cycle-06-structural-repair.cjs";
await build({ entryPoints: ["./scripts/cycle-06-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const lib = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);
const passed = [];
const check = (name, fn) => { fn(); passed.push(name); };
const role = (name, industry, description, offeringLabel, sellerIndustry, targetIndustries) =>
  lib.classifyCandidateBuyerRole({ name, industry, description, offeringLabel, sellerIndustry, targetIndustries });

check("historical canonical is reusable", () => {
  const seen = new Set(); assert.equal(lib.acceptCurrentRunIdentity(seen, "acme.com"), true);
});
check("current run duplicate is prevented", () => {
  const seen = new Set(["acme.com"]); assert.equal(lib.acceptCurrentRunIdentity(seen, "acme.com"), false);
});
check("different historical membership is not a run duplicate", () => {
  assert.equal(lib.acceptCurrentRunIdentity(new Set(), "acme.com"), true);
});
check("seller role is explicit", () => assert.equal(role("SecureOps", "Computer and Network Security", "Managed SOC services provider", "Managed SOC", "Computer and Network Security", ["SaaS"]), "SELLER_COMPETITOR"));
check("managed SOC seller is research gated", () => assert.equal(lib.buyerRoleAllowsBuyerResearch("SELLER_COMPETITOR"), false));
check("managed SOC seller is ranking gated", () => assert.equal(lib.buyerRoleAllowsBuyerOpportunity("SELLER_COMPETITOR"), false));
check("recruitment agency is role gated", () => assert.equal(lib.buyerRoleAllowsBuyerResearch(role("RecruitCo Agency", "Staffing", "Recruitment services agency", "Recruitment services", "Staffing", ["Manufacturing"])), false));
check("ERP consultancy is role gated", () => assert.equal(lib.buyerRoleAllowsBuyerOpportunity(role("ERP Consulting", "IT Services", "ERP implementation consultancy", "ERP implementation", "IT Services", ["Wholesale"])), false));
check("solar vendor is role gated", () => assert.equal(lib.buyerRoleAllowsBuyerResearch(role("Solar Vendor", "Renewable Energy", "commercial solar installer vendor", "Commercial solar", "Renewable Energy", ["Logistics"])), false));
check("potential buyer remains eligible", () => assert.equal(lib.buyerRoleAllowsBuyerResearch("POTENTIAL_BUYER"), true));
check("unknown never becomes potential buyer", () => assert.equal(role("Mystery Co", null, null, "Managed SOC", "Security", ["SaaS"]), "UNKNOWN"));
check("unknown has no implicit rank exclusion", () => assert.equal(lib.buyerRoleAllowsBuyerOpportunity("UNKNOWN"), true));
check("successful provider maps succeeded", () => assert.equal(lib.terminalStatusForResponse("success"), "SUCCEEDED"));
check("empty provider maps no results", () => assert.equal(lib.terminalStatusForResponse("empty"), "NO_RESULTS"));
check("failed provider maps provider error", () => assert.equal(lib.terminalStatusForResponse("failed"), "PROVIDER_ERROR"));
check("irrelevant results map insufficient", () => assert.equal(lib.terminalStatusForResponse("success", "INSUFFICIENT_RETRIEVAL"), "INSUFFICIENT_RESULTS"));
check("ambiguous results map insufficient", () => assert.equal(lib.terminalStatusForResponse("success", "AMBIGUOUS_RETRIEVAL"), "INSUFFICIENT_RESULTS"));
check("accepted retrieval maps succeeded", () => assert.equal(lib.terminalStatusForResponse("success", "SUFFICIENT_RETRIEVAL"), "SUCCEEDED"));
check("coverage counts reused canonicals", () => {
  const summary = lib.summarizeDiscoveryCoverage({ rawResults: 52, duplicatesRemoved: 2, candidates: Array.from({ length: 50 }, (_, i) => ({ companyId: String(i), existingOrNew: i < 20 ? "EXISTING" : "NEW", buyerRole: "POTENTIAL_BUYER" })) }, 50);
  assert.deepEqual([summary.existingCanonicalReused, summary.newCanonicalCreated, summary.uniqueEvaluable], [20, 30, 50]);
});
check("coverage target is constructable", () => {
  const summary = lib.summarizeDiscoveryCoverage({ rawResults: 50, duplicatesRemoved: 0, candidates: Array.from({ length: 50 }, (_, i) => ({ companyId: String(i), existingOrNew: "EXISTING", buyerRole: "POTENTIAL_BUYER" })) }, 50);
  assert.equal(summary.canConstructTarget, true);
});
const cacheInput = (overrides = {}) => ({
  visibility: "PUBLIC", companyId: "cached-1", identityKey: "cached.example",
  seenCompanyIds: new Set(), seenIdentities: new Set(), identityState: "CONFIRMED",
  assessment: { classification: "LIKELY_FIT", buyerRole: "POTENTIAL_BUYER" },
  ...overrides,
});
check("public discovery cache canonical is reusable", () =>
  assert.equal(lib.canReusePublicDiscoveryCanonical(cacheInput()), true));
check("private or scoped cache is excluded", () =>
  assert.equal(lib.canReusePublicDiscoveryCanonical(cacheInput({ visibility: "PRIVATE" })), false));
check("current run canonical cache duplicate is excluded", () =>
  assert.equal(lib.canReusePublicDiscoveryCanonical(cacheInput({ seenCompanyIds: new Set(["cached-1"]) })), false));
check("seller canonical cache entry is excluded", () =>
  assert.equal(lib.canReusePublicDiscoveryCanonical(cacheInput({ assessment: { classification: "LIKELY_NOT_FIT", buyerRole: "SELLER_COMPETITOR" } })), false));

console.info(`Cycle 06 structural regressions: ${passed.length}/24 PASS`);
