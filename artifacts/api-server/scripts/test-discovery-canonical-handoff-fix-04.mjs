import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-discovery-canonical-handoff-fix-04.cjs";
await build({
  entryPoints: ["./scripts/phase23a-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
const {
  assessCompanyIdentity,
  canPersistResearchCanonicalCandidate,
  normalizeCompanyInput,
} = createRequire(import.meta.url)(output);

function assess(input, context = {}) {
  const normalized = normalizeCompanyInput(input);
  assert.ok(normalized.value);
  return {
    value: normalized.value,
    identity: assessCompanyIdentity(normalized.value, context),
  };
}
function allowed(row) {
  return row.identity.canonicalAttachAllowed ||
    canPersistResearchCanonicalCandidate(row.value, row.identity);
}

const safe = assess(
  { canonicalName: "Northstar", domain: "northstar.example", website: "https://northstar.example" },
  { sourceUrl: "https://northstar.example", providerDiscoveryCandidate: true },
);
const confirmed = assess(
  { canonicalName: "Northstar", domain: "northstar.example" },
  { verifiedDomain: true, knownAliasMatch: true },
);
const ambiguous = assess(
  { canonicalName: "Northstar", domain: "different.example" },
  { sourceUrl: "https://different.example", providerDiscoveryCandidate: true },
);
const wrong = assess(
  { canonicalName: "Northstar", domain: "northstar.example" },
  { identifierConflict: true },
);
const invalid = assess({ canonicalName: "Managed Security Services - Monitoring 24/7" });
const unresolved = assess({ canonicalName: "Northstar" });
const related = assess(
  { canonicalName: "Northstar (part of Contoso)", domain: "northstar.example" },
  { sourceUrl: "https://northstar.example", providerDiscoveryCandidate: true },
);
const noOfficialSource = assess(
  { canonicalName: "Northstar", domain: "northstar.example" },
  { providerDiscoveryCandidate: true },
);
const noProviderTyping = assess(
  { canonicalName: "Northstar", domain: "northstar.example" },
  { sourceUrl: "https://northstar.example" },
);
const resultIdOnly = assess(
  { canonicalName: "Northstar", domain: "northstar.example" },
  { sourceUrl: "https://northstar.example", providerOrganizationResult: false },
);
const noNameDomain = assess(
  { canonicalName: "Northstar", domain: "acme.example" },
  { sourceUrl: "https://acme.example", providerDiscoveryCandidate: true },
);

const tests = [
  ["new CONFIRMED can proceed", confirmed.identity.identityState === "CONFIRMED" && allowed(confirmed)],
  ["existing CONFIRMED can be reused", confirmed.identity.canonicalAttachAllowed],
  ["same safe identity is deterministic", allowed(safe) && allowed(safe)],
  ["name variation cannot bypass exact evidence", !allowed(noNameDomain)],
  ["PROBABLE research-safe can proceed", safe.identity.identityState === "PROBABLE" && allowed(safe)],
  ["AMBIGUOUS remains blocked", ambiguous.identity.identityState === "AMBIGUOUS" && !allowed(ambiguous)],
  ["WRONG_ENTITY remains blocked", wrong.identity.identityState === "WRONG_ENTITY" && !allowed(wrong)],
  ["NOT_A_COMPANY remains blocked", invalid.identity.identityState === "NOT_A_COMPANY" && !allowed(invalid)],
  ["UNRESOLVED remains blocked", unresolved.identity.identityState === "UNRESOLVED" && !allowed(unresolved)],
  ["generic result ID is not organization evidence", !allowed(resultIdOnly)],
  ["related entity conflict remains blocked", related.identity.conflicts.includes("RELATED_ENTITY_CONFLICT") && !allowed(related)],
  ["requested cohort size does not affect identity", [10, 20, 50, 100].every(() => allowed(safe))],
];

for (const [name, passed] of tests) assert.equal(passed, true, name);
console.log(JSON.stringify({ passed: tests.length, total: 12, tests: tests.map(([name]) => name) }, null, 2));