import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-admin-quality-test.mjs";
await build({
  entryPoints: ["./scripts/admin-quality-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
});
const mod = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

assert.equal(mod.isInternalAdmin("user_admin", undefined, "user_admin,user_2"), true);
assert.equal(mod.isInternalAdmin("normal_user", undefined, "user_admin"), false);
assert.equal(mod.isInternalAdmin("claim_admin", { publicMetadata: { internalAdmin: true } }, ""), true);
assert.equal(mod.isInternalAdmin("org_owner", { org_role: "org:admin" }, ""), false);

const now = new Date("2026-08-30T00:00:00.000Z");
assert.equal(mod.windowInput(undefined, now).days, 30);
assert.equal(mod.windowInput(500, now).days, 90);
assert.equal(mod.windowInput(-5, now).days, 1);
assert.equal(mod.rate(5, 10), 0.5);
assert.equal(mod.rate(0, 0), null);

mod.assertAggregateOnly({
  sections: Object.fromEntries([
    "providerHealth", "researchSuccess", "researchCost", "evidenceQuality",
    "factExtractionQuality", "signalQuality", "signalFalsePositives",
    "clusterPerformance", "opportunityStateDistribution", "outcomeQuality",
    "modelVersions", "failedJobs", "staleResearch",
  ].map((name) => [name, { sampleSize: 0, rows: [] }])),
});
for (const privateKey of [
  "organizationId", "projectId", "companyId", "sourceUrl", "evidenceText",
  "contactName", "recommendationCopy", "sourcePayload",
]) {
  assert.throws(() => mod.assertAggregateOnly({ [privateKey]: "secret" }));
}

console.log("Admin quality authorization, window, metric-family, and privacy tests passed.");