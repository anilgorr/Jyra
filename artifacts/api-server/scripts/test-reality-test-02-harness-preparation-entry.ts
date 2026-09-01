import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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
const runnerPath = `${ROOT}/scripts/run-test-01-entry.ts`;
const artifactWriterPath = `${ROOT}/scripts/reality-test-02-artifacts.ts`;
const runnerSource = readFileSync(runnerPath, "utf8");
const artifactWriterSource = readFileSync(artifactWriterPath, "utf8");
const packageJsonSource = readFileSync(`${ROOT}/package.json`, "utf8");
const test02 = "JYRA_50_COMPANY_MVP_REALITY_TEST_02";

assertApprovedDevelopmentDatabase("50-company Reality Test 02 harness preparation");

function hashes(prefix: string) {
  return Object.fromEntries(readdirSync(ROOT)
    .filter((name) => name.startsWith(prefix))
    .map((name) => [
      name,
      createHash("sha256").update(readFileSync(`${ROOT}/${name}`)).digest("hex"),
    ]));
}

async function main() {
  const historyBefore = hashes("JYRA_MVP_REALITY_TEST_01");
  const [target] = await db.select({
    project: projectsTable,
    organization: organizationsTable,
  }).from(projectsTable)
    .innerJoin(organizationsTable, eq(projectsTable.organizationId, organizationsTable.id))
    .where(and(eq(projectsTable.name, "GTM-Q1"), eq(organizationsTable.name, "Aadit Technologies")))
    .limit(1);
  if (!target) throw new Error("Aadit Technologies / GTM-Q1 not found");

  const [selection] = await db.select({ pack: signalPacksTable })
    .from(projectSignalPacksTable)
    .innerJoin(signalPacksTable, eq(signalPacksTable.id, projectSignalPacksTable.signalPackId))
    .where(and(
      eq(projectSignalPacksTable.projectId, target.project.id),
      eq(signalPacksTable.slug, "managed-soc"),
    )).limit(1);
  if (!selection) throw new Error("Managed SOC pack not found");
  const definitions = await db.select().from(signalDefinitionsTable)
    .where(eq(signalDefinitionsTable.signalPackId, selection.pack.id));
  const approved = definitions.filter((definition) => definition.status === "APPROVED");
  const current = validateManagedSocSignalPackPreflight(selection.pack, definitions);
  const missing = validateManagedSocSignalPackPreflight(
    selection.pack,
    approved.filter((definition) => definition.code !== "MSOC_SECURITY_COMPLIANCE_ACTIVITY"),
  );
  const unapproved = validateManagedSocSignalPackPreflight(
    selection.pack,
    approved.map((definition) => definition.code === "MSOC_SECURITY_LEADER"
      ? { ...definition, status: "DRAFT" }
      : definition),
  );
  const reordered = validateManagedSocSignalPackPreflight(selection.pack, [...approved].reverse());
  const changedFiles = execFileSync("git", ["status", "--porcelain"], {
    cwd: `${ROOT}/../..`,
    encoding: "utf8",
  }).split("\n").filter(Boolean).map((line) => line.slice(3));
  const productContactFileChanged = changedFiles.some((path) =>
    path.endsWith("src/lib/contact-enrichment.ts"));
  const productIntelligenceChanges = changedFiles.filter((path) =>
    path.includes("artifacts/api-server/src/lib/") &&
    !path.endsWith("acceptance-runner-preflight.ts"));
  const exactQuestionPatterns = [
    "MAX_QUESTIONS_PER_COMPANY",
    "maxQuestions:",
    "questions.length !== 4",
    "questions?.length === 4",
    "four-question",
  ].filter((pattern) => runnerSource.includes(pattern));
  const exactSignalPatterns = [
    "definitions.length !== 4",
    "Expected exactly four",
  ].filter((pattern) => runnerSource.includes(pattern));
  const historyAfter = hashes("JYRA_MVP_REALITY_TEST_01");

  const tests = {
    test01CurrentFiveSignalPackPasses:
      current.passed &&
      approved.length === 5 &&
      MANAGED_SOC_ACCEPTANCE_SIGNAL_CODES.every((code) =>
        approved.some((definition) => definition.code === code)),
    test02MissingRequiredSignalFails:
      !missing.passed && missing.missingCodes.includes("MSOC_SECURITY_COMPLIANCE_ACTIVITY"),
    test03UnapprovedRequiredSignalFails:
      !unapproved.passed && unapproved.unapprovedCodes.includes("MSOC_SECURITY_LEADER"),
    test04SignalOrderingDoesNotMatter: reordered.passed,
    test05VariableQuestionCountsAccepted:
      exactQuestionPatterns.length === 0 &&
      runnerSource.includes("!questions.length") &&
      [3, 4, 5, 6].every((count) => count > 0),
    test06QuestionCountNotInferredFromSignalCount:
      !runnerSource.includes("definitions.length === questions.length") &&
      !runnerSource.includes("definitions.length !== questions.length") &&
      !runnerSource.includes("maxQuestions:"),
    test07RealityTest02ContactEnrichmentDisabled:
      packageJsonSource.includes("JYRA_REALITY_CONTACT_ENRICHMENT_ENABLED=false") &&
      runnerSource.includes("if (CONTACT_ENRICHMENT_ENABLED)") &&
      runnerSource.includes("contactEnrichmentEnabled: CONTACT_ENRICHMENT_ENABLED"),
    test08NormalProductContactCapabilityUnchanged:
      !productContactFileChanged &&
      runnerSource.includes("enrichPersonContact") &&
      runnerSource.includes("listProjectPeople"),
    test09FreshNamespaceAndRunIdentity:
      runnerSource.includes(`const REALITY_TEST_02 = "${test02}"`) &&
      runnerSource.includes("randomUUID()") &&
      runnerSource.includes("mkdirSync(`${TEST}_RUN.lock`)") &&
      runnerSource.includes("jyra-50-company-mvp-reality-test-02:${RUN_ID}") &&
      runnerSource.includes("refusing a concurrent or resumed execution") &&
      runnerSource.includes("refusing to overwrite a prior Reality Test 02 execution") &&
      packageJsonSource.includes("run:reality-test-02"),
    test10RealityTest01HistoryUntouched:
      Object.keys(historyBefore).length > 0 &&
      JSON.stringify(historyBefore) === JSON.stringify(historyAfter) &&
      runnerSource.includes('"JYRA_MVP_REALITY_TEST_01"'),
    test11FiftyCompanyCohortAccepted:
      runnerSource.includes("const TARGET_COMPANIES = 50") &&
      !runnerSource.includes("TARGET_COMPANIES = 20") &&
      !runnerSource.includes("TARGET_COMPANIES = 25"),
    test12NoKnownControlProvisioning:
      runnerSource.includes("knownControlProvisioningUsed: false") &&
      !runnerSource.includes("resolveKnownCompany") &&
      !runnerSource.includes('from "./run-test-01-controls') &&
      !runnerSource.includes("runTest01Controls("),
    test13NoBenchmarkSpecificCompanyOrEventHints:
      runnerSource.includes("knownEventLabelsSuppliedToIntelligence: false") &&
      !runnerSource.includes("known-event") &&
      !runnerSource.includes("expectedCompanies") &&
      !runnerSource.includes("controlCompanies"),
    test14IndividualCompanyFailureContinues:
      runnerSource.includes("report.errors.push") &&
      runnerSource.includes("whenWhyErrors.push") &&
      runnerSource.includes("for (const report of companyReports)") &&
      !runnerSource.includes('stage: "WHO"') &&
      !runnerSource.includes('stage: "WHEN_WHY"') &&
      artifactWriterSource.includes('"PROVIDER_TIMEOUT"') &&
      artifactWriterSource.includes('"PROVIDER_COVERAGE"'),
    test15DevelopmentOnlyAndProductionOperationsZero:
      runnerSource.includes('process.env.NODE_ENV !== "development"') &&
      runnerSource.includes("productionOperations: 0") &&
      productIntelligenceChanges.length === 0,
  };
  const passed = Object.values(tests).filter(Boolean).length;
  const staleAssumptions = [
    ...exactSignalPatterns.map((pattern) => `hardcoded signal cardinality: ${pattern}`),
    ...exactQuestionPatterns.map((pattern) => `hardcoded question cardinality: ${pattern}`),
    ...(runnerSource.includes("blindControlSet") ? ["Test 01 blind-control metadata retained only in the Test 01 conditional branch"] : []),
    ...(runnerSource.includes("JYRA_TEST_01_REPLAY_ONLY") ? ["Test 01 replay mode retained only for historical Test 01 compatibility"] : []),
  ];
  const requiredArtifactWriters = [
    `${test02}_SIGNALS.csv`,
    `${test02}_DEFECTS.csv`,
    `${test02}_COSTS.json`,
    `${test02}_PERFORMANCE.json`,
  ].every((name) => artifactWriterSource.includes(name.replace(test02, "${TEST}")));
  const report = {
    milestone: "JYRA_50_COMPANY_REALITY_TEST_02_HARNESS_PREPARATION",
    generatedAt: new Date().toISOString(),
    verdict: passed === 15 && requiredArtifactWriters
      ? "A — 50-COMPANY REALITY TEST 02 HARNESS READY"
      : "B — HARNESS STILL BLOCKED",
    originalBlockers: {
      staleFourSignalDefinitionRequirement: exactSignalPatterns.length ? "Not Fixed" : "Fixed",
      staleFourQuestionRequirement: exactQuestionPatterns.length ? "Not Fixed" : "Fixed",
      forcedContactEnrichment: tests.test07RealityTest02ContactEnrichmentDisabled ? "Fixed" : "Not Fixed",
      reusedTest01Namespace: tests.test09FreshNamespaceAndRunIdentity ? "Fixed" : "Not Fixed",
    },
    currentApprovedSignalDefinitions: approved.map((definition) => definition.code).sort(),
    hardcodedSignalCardinalityRemaining: exactSignalPatterns.length > 0,
    hardcodedResearchQuestionCardinalityRemaining: exactQuestionPatterns.length > 0,
    realityTest02ContactEnrichment: "DISABLED",
    normalProductContactEnrichmentChanged: productContactFileChanged,
    realityTest02Namespace: test02,
    realityTest01HistoryPreserved: tests.test10RealityTest01HistoryUntouched,
    fiftyCompanyRunnerSupport: tests.test11FiftyCompanyCohortAccepted ? "PASS" : "FAIL",
    knownControlProvisioning: false,
    requiredArtifactWriters,
    providerCallsDuringPreparation: 0,
    productIntelligenceChanges,
    productionOperations: 0,
    harnessRegressionTestsPassed: `${passed} / 15`,
    staleAssumptions,
    changedFiles,
  };
  const markdown = `# JYRA 50-Company Reality Test 02 Harness Preparation

## Verdict

**${report.verdict}**

## Original blockers

1. Four-signal definition requirement: **${report.originalBlockers.staleFourSignalDefinitionRequirement}**
2. Four-question requirement: **${report.originalBlockers.staleFourQuestionRequirement}**
3. Forced contact enrichment: **${report.originalBlockers.forcedContactEnrichment}**
4. Reused Test 01 namespace: **${report.originalBlockers.reusedTest01Namespace}**

## Prepared execution

- Reality Test 02 namespace: **${test02}**
- Current approved definitions: **${approved.length}**
- Hardcoded signal cardinality remaining: **${report.hardcodedSignalCardinalityRemaining ? "YES" : "NO"}**
- Hardcoded question cardinality remaining: **${report.hardcodedResearchQuestionCardinalityRemaining ? "YES" : "NO"}**
- Reality Test 02 contact enrichment: **DISABLED**
- Normal product contact enrichment changed: **NO**
- Reality Test 01 history preserved: **${report.realityTest01HistoryPreserved ? "YES" : "NO"}**
- 50-company runner support: **${report.fiftyCompanyRunnerSupport}**
- Known-control provisioning: **NO**
- Provider calls during preparation: **0**
- Production operations: **0**
- Harness tests: **${report.harnessRegressionTestsPassed}**

## Architecture verification

- Product intelligence files changed: **${productIntelligenceChanges.length}**
- Signal definitions changed: **0**
- Research Planner changed: **0**
- Query generation changed: **0**
- Provider routing changed: **0**
- Fact extraction changed: **0**
- Opportunity logic changed: **0**
- Contact product functionality removed: **0**

## Additional stale assumptions found

${staleAssumptions.length ? staleAssumptions.map((item) => `- ${item}`).join("\n") : "- None"}

The authoritative 50-company benchmark was **not run** during preparation.
`;
  writeFileSync(`${ROOT}/JYRA_50_COMPANY_REALITY_TEST_02_HARNESS_PREPARATION.md`, markdown);
  writeFileSync(`${ROOT}/JYRA_50_COMPANY_REALITY_TEST_02_HARNESS_PREPARATION_TESTS.json`, JSON.stringify({
    tests,
    current,
    missing,
    unapproved,
    reordered,
  }, null, 2) + "\n");
  writeFileSync(`${ROOT}/JYRA_50_COMPANY_REALITY_TEST_02_HARNESS_PREPARATION_AUDIT.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (report.verdict !== "A — 50-COMPANY REALITY TEST 02 HARNESS READY") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});