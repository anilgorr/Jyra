import { existsSync, readFileSync } from "node:fs";

const test = "JYRA_50_COMPANY_MVP_REALITY_TEST_02";
const required = [
  `${test}.md`,
  `${test}.json`,
  `${test}_COMPANIES.csv`,
  `${test}_TOP10.csv`,
  `${test}_SIGNALS.csv`,
  `${test}_DEFECTS.csv`,
  `${test}_COSTS.json`,
  `${test}_PERFORMANCE.json`,
];
const missing = required.filter((path) => !existsSync(path));
if (missing.length) throw new Error(`Reality Test 02 report is incomplete: ${missing.join(", ")}`);
const report = JSON.parse(readFileSync(`${test}.json`, "utf8"));
console.log(JSON.stringify({
  test,
  runId: report.runId,
  startedAt: report.execution?.startedAt,
  completedAt: report.execution?.completedAt,
  verdict: report.verdict,
  population: report.metrics?.totalCompanies,
  contactEnrichmentEnabled: report.execution?.contactEnrichmentEnabled,
  productionOperations: report.safety?.productionOperations,
  artifacts: required,
}, null, 2));