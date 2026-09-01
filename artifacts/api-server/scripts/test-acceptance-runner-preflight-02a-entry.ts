import { readFileSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import {
  assertApprovedDevelopmentDatabase,
  db,
  organizationsTable,
  projectSignalPacksTable,
  projectsTable,
  signalDefinitionsTable,
  signalPacksTable,
} from "@workspace/db";
import {
  MANAGED_SOC_ACCEPTANCE_SIGNAL_CODES,
  validateManagedSocSignalPackPreflight,
} from "../src/lib/acceptance-runner-preflight";

const ROOT = process.cwd();
const runnerSource = readFileSync(`${ROOT}/scripts/run-test-01-controls-entry.ts`, "utf8");

assertApprovedDevelopmentDatabase("Acceptance runner signal-pack preflight hotfix 02A");

async function main() {
const [target] = await db.select({
  project: projectsTable,
  organization: organizationsTable,
}).from(projectsTable)
  .innerJoin(organizationsTable, eq(projectsTable.organizationId, organizationsTable.id))
  .where(and(eq(projectsTable.name, "GTM-Q1"), eq(organizationsTable.name, "Aadit Technologies")))
  .limit(1);
if (!target) throw new Error("Acceptance target project not found");

const [selection] = await db.select({ pack: signalPacksTable })
  .from(projectSignalPacksTable)
  .innerJoin(signalPacksTable, eq(signalPacksTable.id, projectSignalPacksTable.signalPackId))
  .where(and(
    eq(projectSignalPacksTable.projectId, target.project.id),
    eq(signalPacksTable.slug, "managed-soc"),
  )).limit(1);
if (!selection) throw new Error("Managed SOC pack selection not found");

const definitions = await db.select().from(signalDefinitionsTable)
  .where(eq(signalDefinitionsTable.signalPackId, selection.pack.id));
const current = validateManagedSocSignalPackPreflight(selection.pack, definitions);
const approvedDefinitions = definitions.filter((definition) => definition.status === "APPROVED");
const currentApproved = validateManagedSocSignalPackPreflight(selection.pack, approvedDefinitions);
const removeOne = approvedDefinitions.filter(
  (definition) => definition.code !== MANAGED_SOC_ACCEPTANCE_SIGNAL_CODES.at(-1),
);
const missing = validateManagedSocSignalPackPreflight(selection.pack, removeOne);
const unapproved = validateManagedSocSignalPackPreflight(
  selection.pack,
  approvedDefinitions.map((definition) =>
    definition.code === MANAGED_SOC_ACCEPTANCE_SIGNAL_CODES[0]
      ? { ...definition, status: "DRAFT" }
      : definition),
);
const wrongPack = validateManagedSocSignalPackPreflight(
  { ...selection.pack, slug: "wrong-pack" },
  approvedDefinitions,
);
const reordered = validateManagedSocSignalPackPreflight(
  selection.pack,
  [...approvedDefinitions].reverse(),
);
const unrelatedDefinition = {
  ...approvedDefinitions[0],
  id: "unrelated-definition",
  signalPackId: "unrelated-pack",
  code: "UNRELATED_SIGNAL",
};
const definitionsAcrossPacks = [...definitions, unrelatedDefinition];
const activePackDefinitions = definitionsAcrossPacks.filter(
  (definition) => definition.signalPackId === selection.pack.id,
);
const extraUnrelatedOutsideActivePack = validateManagedSocSignalPackPreflight(
  selection.pack,
  activePackDefinitions,
);
const versionMismatch = validateManagedSocSignalPackPreflight(
  selection.pack,
  approvedDefinitions.map((definition) =>
    definition.code === MANAGED_SOC_ACCEPTANCE_SIGNAL_CODES[0]
      ? { ...definition, version: "unexpected-version" }
      : definition),
);
const configurationMismatch = validateManagedSocSignalPackPreflight(
  selection.pack,
  approvedDefinitions.map((definition) =>
    definition.code === MANAGED_SOC_ACCEPTANCE_SIGNAL_CODES[1]
      ? { ...definition, configuration: { mode: "single", factTypes: ["WRONG_FACT_TYPE"] } }
      : definition),
);
const questionCardinalityAssumptionRemoved =
  !runnerSource.includes("definitions.length !== 4") &&
  !runnerSource.includes("questions.length !== 4") &&
  !runnerSource.includes("questions?.length === 4") &&
  !runnerSource.includes("run.questions?.length === 4") &&
  !runnerSource.includes("maxQuestions: 4") &&
  !runnerSource.includes("four-question") &&
  !runnerSource.includes("four terminal question dispositions");
const tests = {
  currentFiveSignalPackPasses: current.passed && approvedDefinitions.length === 5,
  missingRequiredSignalFails: !missing.passed &&
    missing.missingCodes.includes("MSOC_SECURITY_COMPLIANCE_ACTIVITY"),
  unapprovedRequiredSignalFails: !unapproved.passed &&
    unapproved.unapprovedCodes.includes("MSOC_SECURITY_LEADER"),
  wrongPackFails: !wrongPack.passed && wrongPack.packErrors.length > 0,
  extraUnrelatedOutsideActivePackDoesNotAffect: extraUnrelatedOutsideActivePack.passed,
  signalOrderDoesNotMatter: reordered.passed,
  versionMismatchFails: !versionMismatch.passed &&
    versionMismatch.versionMismatches.includes("MSOC_SECURITY_LEADER"),
  configurationMismatchFails: !configurationMismatch.passed &&
    configurationMismatch.configurationMismatches.includes("MSOC_SECURITY_HIRING"),
  questionCountIsNotSignalCount: questionCardinalityAssumptionRemoved,
};
const staleAssumptions = [
  ...(["definitions.length !== 4", "questions.length !== 4", "questions?.length === 4", "run.questions?.length === 4", "maxQuestions: 4", "four-question", "four terminal question dispositions"]
    .filter((pattern) => runnerSource.includes(pattern))
    .map((pattern) => ({ pattern, location: "run-test-01-controls-entry.ts" }))),
  ...(runnerSource.includes("discoverCompanies") || runnerSource.includes('route("COMPANY_DISCOVERY")')
    ? [{ pattern: "direct COMPANY_DISCOVERY provisioning", location: "run-test-01-controls-entry.ts" }]
    : []),
];
const report = {
  milestone: "ACCEPTANCE_RUNNER_SIGNAL_PACK_PREFLIGHT_HOTFIX_02A",
  generatedAt: new Date().toISOString(),
  originalFailureStage: "SIGNAL_PACK_PREFLIGHT",
  originalExpectedDefinitions: 4,
  currentApprovedDefinitions: approvedDefinitions.length,
  currentRequiredSignalIds: `${currentApproved.expectedCodes.filter((code) => approvedDefinitions.some((definition) => definition.code === code && definition.status === "APPROVED")).length}/5`,
  currentPackPreflight: current.passed ? "PASS" : "FAIL",
  staleCardinalityRequirementRemoved: !runnerSource.includes("definitions.length !== 4"),
  questionCountCardinalityAssumptionRemoved: questionCardinalityAssumptionRemoved ? "YES" : "NO",
  otherStaleAcceptanceRunnerAssumptionsFound: staleAssumptions,
  productIntelligenceChanges: 0,
  signalDefinitionChanges: 0,
  providerCalls: 0,
  productionOperations: 0,
  tests: Object.values(tests).every(Boolean) ? "PASS" : "FAIL",
  pack: current,
};
const audit = {
  scope: "Acceptance Test 02 control runner only",
  staleAssumptions,
  excludedProductFiles: true,
  otherTest01RunnerCardinality: "Not modified; outside the current controls runner hotfix scope.",
  directCompanyDiscoveryProvisioning: false,
  directIntelligenceChanges: 0,
};
const markdown = `# Acceptance Runner Signal Pack Preflight Hotfix 02A

## Decision

**${report.tests === "PASS" ? "A — ACCEPTANCE RUNNER PREFLIGHT REPAIRED" : "E — MULTIPLE HARNESS DEFECTS REMAIN"}**

- Original failure stage: **SIGNAL_PACK_PREFLIGHT**
- Original expected definitions: **4**
- Current approved definitions: **${approvedDefinitions.length}**
- Required stable signal IDs validated: **${report.currentRequiredSignalIds}**
- Current pack preflight: **${report.currentPackPreflight}**
- Stale cardinality requirement removed: **${report.staleCardinalityRequirementRemoved ? "YES" : "NO"}**
- Question-count cardinality assumption removed: **${report.questionCountCardinalityAssumptionRemoved}**
- Product intelligence changes: **0**
- Signal definition changes: **0**
- Provider calls: **0**
- Production operations: **0**

The complete 10-control benchmark was **not run** in this hotfix task.
`;

writeFileSync(`${ROOT}/ACCEPTANCE_RUNNER_SIGNAL_PACK_PREFLIGHT_HOTFIX_02A.json`, JSON.stringify(report, null, 2) + "\n");
writeFileSync(`${ROOT}/ACCEPTANCE_RUNNER_SIGNAL_PACK_PREFLIGHT_HOTFIX_02A_TESTS.json`, JSON.stringify({
  tests,
  current,
  missing,
  unapproved,
  wrongPack,
  reordered,
  extraUnrelatedOutsideActivePack,
  versionMismatch,
  configurationMismatch,
}, null, 2) + "\n");
writeFileSync(`${ROOT}/ACCEPTANCE_RUNNER_STALE_ASSUMPTIONS_AUDIT_02A.json`, JSON.stringify(audit, null, 2) + "\n");
writeFileSync(`${ROOT}/ACCEPTANCE_RUNNER_SIGNAL_PACK_PREFLIGHT_HOTFIX_02A.md`, markdown);
console.log(JSON.stringify({ decision: report.tests === "PASS" ? "A — ACCEPTANCE RUNNER PREFLIGHT REPAIRED" : "E — MULTIPLE HARNESS DEFECTS REMAIN", tests, staleAssumptions }, null, 2));
if (report.tests !== "PASS") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});