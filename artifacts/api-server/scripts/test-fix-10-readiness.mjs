import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-fix-10-readiness.cjs";
await build({
  stdin: {
    contents: `import { evaluateProjectReadiness, assembleSellerContext } from "./src/lib/seller-context";
      export { evaluateProjectReadiness, assembleSellerContext };`,
    resolveDir: process.cwd(), sourcefile: "fix-10-readiness-entry.ts", loader: "ts",
  },
  outfile: output, bundle: true, format: "cjs", platform: "node", external: ["pg-native"],
});
const { evaluateProjectReadiness, assembleSellerContext } = createRequire(import.meta.url)(output);
const stamp = new Date("2025-01-01T00:00:00Z");
const base = (offering, overrides = {}) => ({
  projectId: "project", organizationId: "tenant-a",
  twin: { id: "twin-v1", businessTwinId: "twin", version: 1, status: "ready", createdAt: stamp,
    rawAnswers: { offeringName: offering, offeringDescription: `${offering} description` }, aiInterpretation: {}, manualInterpretation: {} },
  icp: { id: "icp-v1", icpId: "icp", version: 1, createdAt: stamp, sourceBusinessTwinVersionId: "twin-v1", assumptions: [] },
  ...overrides,
});
for (const offering of ["Managed SOC", "Recruitment", "ERP implementation", "Solar installation"]) {
  const result = evaluateProjectReadiness(base(offering));
  assert.equal(result.marketDiscoveryReady, true);
  assert.equal(result.context.offeringName, offering);
  assert.equal(result.buyerRoleReady, true);
  assert.equal(result.whenWhyReady, false, "pack is not required for buyer role/discovery/WHO");
}
assert.equal(evaluateProjectReadiness(base("the seller offering")).offeringReady, false);
assert.ok(evaluateProjectReadiness(base("the seller offering")).missingRequirements.includes("OFFERING_PLACEHOLDER"));
assert.equal(evaluateProjectReadiness(base("", { icp: null })).marketDiscoveryReady, false);
assert.equal(evaluateProjectReadiness(base("Managed SOC", { icp: null })).buyerRoleReady, true);
assert.equal(evaluateProjectReadiness(base("Managed SOC", { icp: null })).whoReady, false);
assert.equal(evaluateProjectReadiness(base("Managed SOC", { expectedOrganizationId: "tenant-b" })).marketDiscoveryReady, false);
assert.ok(evaluateProjectReadiness(base("Managed SOC", { expectedOrganizationId: "tenant-b" })).missingRequirements.includes("ORGANIZATION_MISMATCH"));
const packOverride = assembleSellerContext({
  twin: base("Managed SOC").twin, icp: base("Managed SOC").icp,
  pack: { id: "pack", offeringKey: "soc" },
  packVersion: { id: "pack-v1", offeringSnapshot: { name: "Managed Detection & Response", description: "MDR" } },
});
assert.equal(packOverride.offeringName, "Managed Detection & Response");
const mapped = assembleSellerContext({ twin: {
  id: "mapping", businessTwinId: "twin", rawAnswers: { offeringName: "Managed SOC", productOrServiceDescription: "24/7 monitoring", problemsSolved: ["Alert fatigue"] },
  aiInterpretation: {}, manualInterpretation: {},
} });
assert.equal(mapped.offeringDescription, "24/7 monitoring");
assert.deepEqual(mapped.offeringCapabilities, ["Alert fatigue"]);
// A previously captured resolver snapshot remains immutable when a newer
// Twin/ICP snapshot is later resolved; discovery stores these exact IDs.
const historical = evaluateProjectReadiness(base("Managed SOC"));
const newer = evaluateProjectReadiness(base("Managed SOC", {
  twin: { ...base("Managed SOC").twin, id: "twin-v2", version: 2 },
  icp: { ...base("Managed SOC").icp, id: "icp-v2", version: 2, sourceBusinessTwinVersionId: "twin-v2" },
}));
assert.deepEqual([historical.businessTwinVersionId, historical.icpVersionId], ["twin-v1", "icp-v1"]);
assert.deepEqual([newer.businessTwinVersionId, newer.icpVersionId], ["twin-v2", "icp-v2"]);
const reviewOutput = "/tmp/jyra-fix-10-pack-review-pure.cjs";
await build({
  stdin: { contents: `export { clusterStructuralFinding, validateDisabledClusterIds } from "./scripts/fix-10-pack-review-entry";`,
    resolveDir: process.cwd(), sourcefile: "fix-10-pack-review-pure.ts", loader: "ts" },
  outfile: reviewOutput, bundle: true, format: "cjs", platform: "node", external: ["pg-native"],
});
const { clusterStructuralFinding, validateDisabledClusterIds } = createRequire(import.meta.url)(reviewOutput);
const overlap = clusterStructuralFinding({ id: "cluster-a", requiredSignalCodes: ["A", "B"], negativeSignalCodes: ["B"] });
assert.deepEqual(overlap, { clusterId: "cluster-a", invalid: true, overlap: ["B"] });
assert.throws(() => validateDisabledClusterIds([], ["cluster-a"], ["cluster-a"]), /explicitly disabled/);
assert.throws(() => validateDisabledClusterIds(["foreign"], ["cluster-a"], []), /does not belong/);
validateDisabledClusterIds(["cluster-a"], ["cluster-a"], ["cluster-a"]);
console.log("Fix10 project readiness pure tests passed.");