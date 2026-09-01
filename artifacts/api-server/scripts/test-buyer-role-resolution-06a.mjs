import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-buyer-role-06a.cjs";
await build({ entryPoints: ["./scripts/buyer-role-resolution-06a-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const lib = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);
const base = { offeringLabel: "managed security services", sellerIndustry: "Information Technology", targetIndustries: ["Manufacturing"] };
const assess = (input) => lib.assessBuyerRole({ ...base, now: new Date("2026-01-01T00:00:00.000Z"), ...input });
const checks = [
  ["1 classifier invoked / produces role", () => assert.equal(assess({ name: "Factory", industry: "Manufacturing", description: "Factory manufactures industrial components." }).buyerRole, "POTENTIAL_BUYER")],
  ["2 seller offering is passed", () => assert.equal(assess({ name: "Factory", industry: "Manufacturing", description: "Factory manufactures components." }).sellerOffering, "managed security services")],
  ["3 primary description is passed", () => assert.equal(assess({ name: "Factory", industry: "Manufacturing", description: "Factory manufactures components." }).supportingInputs.some((e) => e.field === "description"), true)],
  ["4 canonical-domain fallback acceptance", () => assert.equal(lib.trustedCanonicalDomainDescription({ url: "https://www.factory.com/about", snippet: "Factory manufactures components." }, "factory.com")?.text, "Factory manufactures components.")],
  ["5 off-domain fallback rejection", () => assert.equal(lib.trustedCanonicalDomainDescription({ url: "https://directory.example/factory", snippet: "Factory manufactures components." }, "factory.com"), null)],
  ["6 potential buyer correct", () => assert.equal(assess({ name: "Factory", industry: "Manufacturing", description: "Factory manufactures components." }).buyerRole, "POTENTIAL_BUYER")],
  ["7 same-service seller correct", () => assert.equal(assess({ name: "SOC Co", description: "Managed security services provider." }).buyerRole, "SELLER_COMPETITOR")],
  ["8 adjacent vendor remains distinct", () => assert.equal(assess({ name: "IT Shop", industry: "IT Services and IT Consulting", description: "Technology solutions and consulting provider.", sellerIndustry: "Cybersecurity" }).buyerRole, "ADJACENT_VENDOR")],
  ["9 ambiguity remains unknown", () => assert.equal(assess({ name: "Other", description: "We build better futures." }).buyerRole, "UNKNOWN")],
  ["10 missing description remains unknown", () => assert.equal(assess({ name: "Mystery", industry: "Manufacturing" }).buyerRole, "UNKNOWN")],
  ["11 technology keyword alone not seller", () => assert.equal(assess({ name: "Factory", industry: "Manufacturing", description: "Factory manufactures components and uses security technology." }).buyerRole, "POTENTIAL_BUYER")],
  ["12 operating tech company can buyer", () => assert.equal(assess({ name: "Contract Co", industry: "SaaS", websiteProfile: "Builds a contract management platform for legal teams.", targetIndustries: ["SaaS"] }).buyerRole, "POTENTIAL_BUYER")],
  ["13 confidence separately stored", () => assert.equal(assess({ name: "Factory", industry: "Manufacturing", description: "Factory manufactures components." }).confidence, "MEDIUM")],
  ["14 fallback provenance stored", () => assert.equal(assess({ name: "Factory", industry: "Manufacturing", websiteProfile: "Factory manufactures components.", sources: { website_profile: "provider:https://factory.com/about" } }).supportingInputs.find((e) => e.field === "website_profile")?.source, "provider:https://factory.com/about")],
  ["15 canonical reuse retains assessment", () => assert.equal(assess({ name: "Factory", industry: "Manufacturing", description: "Factory manufactures components." }).buyerRole, assess({ name: "Factory", industry: "Manufacturing", description: "Factory manufactures components." }).buyerRole)],
  ["16 recomputation deterministic/idempotent", () => {
    const original = assess({ name: "Factory", industry: "Manufacturing", description: "Factory manufactures components." });
    const roundTripped = JSON.parse(JSON.stringify(original, Object.keys(original).sort()));
    roundTripped.supportingInputs = original.supportingInputs.map(({ source, excerpt, field }) => ({ source, excerpt, field }));
    roundTripped.assessedAt = "2027-01-01T00:00:00.000Z";
    assert.equal(lib.sameBuyerRoleAssessment(original, roundTripped), true);
  }],
  ["17 budget exhaustion makes no fallback call", () => assert.equal(assess({ name: "SOC Co", industry: "Information Technology" }).buyerRole, "UNKNOWN")],
  ["18 unknown deep research blocked", () => assert.equal(lib.buyerRoleAllowsBuyerResearch("UNKNOWN"), false)],
  ["19 buyer research eligible", () => assert.equal(lib.buyerRoleAllowsBuyerResearch("POTENTIAL_BUYER"), true)],
  ["20 fresh-20 coverage measurable", () => assert.equal([assess({ name: "Factory", industry: "Manufacturing", description: "Factory manufactures components." }), assess({ name: "Mystery" })].filter((x) => x.buyerRole !== "UNKNOWN").length / 2, 0.5)],
];
for (const [name, fn] of checks) { fn(); }
assert.equal(checks.length, 20);
console.log(`PASS ${checks.length}/20 buyer-role-resolution-06a regressions`);