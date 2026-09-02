import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const paths = {
  freeze: "evaluations/jyra-intelligence-v2/TASK_117_GENERIC_V2_FREEZE.manifest.json",
  predictions: "evaluations/jyra-holdout-v2/TASK_117_V2_PREDICTIONS.json",
  predictionManifest: "evaluations/jyra-holdout-v2/TASK_117_V2_PREDICTIONS.manifest.json",
  gold: "evaluations/jyra-holdout-v2/JYRA_BLIND_HOLDOUT_GOLD_V2.json",
  report: "evaluations/jyra-holdout-v2/TASK_117_V2_HISTORICAL_REGRESSION.json",
  markdown: "evaluations/jyra-holdout-v2/TASK_117_V2_HISTORICAL_REGRESSION.md",
  final: "artifacts/api-server/TASK_117_JYRA_INTELLIGENCE_CORE_V2.json",
};
const expected = {
  freeze: "ee6249675681c2d1e0216d4cd85a2276bed11e1c6dce1e4e179a052ed5b9ab03",
  predictions: "6e6999acb8ef006e466d90081cd65e4cc5106ae73d4d3c7b240b57e5f903b8d0",
  gold: "e9508c226b077229557b8de13ba5e272d2ec963a8a2b9fc88748abed19dbca8e",
};
const bytes = (path) => readFile(new URL(path, root));
const json = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const ratio = (n, d) => d ? n / d : null;

assert.equal(sha256(await bytes(paths.freeze)), expected.freeze, "freeze manifest hash");
assert.equal(sha256(await bytes(paths.predictions)), expected.predictions, "prediction hash");
assert.equal(sha256(await bytes(paths.gold)), expected.gold, "gold hash");
const freeze = await json(paths.freeze);
for (const file of freeze.files) {
  assert.equal(sha256(await bytes(file.path)), file.sha256, `frozen implementation changed: ${file.path}`);
}

const [predictionsDocument, predictionManifest, gold, report, final] = await Promise.all([
  json(paths.predictions), json(paths.predictionManifest), json(paths.gold), json(paths.report), json(paths.final),
]);
assert.equal(predictionManifest.artifactSha256, expected.predictions);
assert.equal(predictionManifest.frozenImplementationManifestSha256, expected.freeze);
assert.equal(predictionsDocument.predictions.length, 16);
assert.equal(gold.length, 16);
const goldById = new Map(gold.map((row) => [row.holdoutCompanyId, row.humanTruth]));
assert.equal(new Set(predictionsDocument.predictions.map((row) => row.holdoutCompanyId)).size, 16);

const roleLabels = ["POTENTIAL_BUYER", "SELLER_COMPETITOR", "ADJACENT_VENDOR", "PARTNER_POSSIBLE", "UNKNOWN", "MISSING"];
const whoLabels = ["LIKELY_FIT", "POSSIBLE_FIT", "LIKELY_NOT_FIT", "INSUFFICIENT_DATA", "MISSING"];
function metric(field, labels) {
  const rows = predictionsDocument.predictions.map((prediction) => ({
    actual: goldById.get(prediction.holdoutCompanyId)[field === "commercialRole" ? "commercialRole" : "who"],
    predicted: prediction[field]?.value ?? "MISSING",
  }));
  const perClass = Object.fromEntries(labels.map((label) => {
    const tp = rows.filter((row) => row.actual === label && row.predicted === label).length;
    const predicted = rows.filter((row) => row.predicted === label).length;
    const actual = rows.filter((row) => row.actual === label).length;
    return [label, { precision: ratio(tp, predicted), recall: ratio(tp, actual), tp, predicted, actual }];
  }));
  const confusionMatrix = labels.map((actual) => labels.map((predicted) =>
    rows.filter((row) => row.actual === actual && row.predicted === predicted).length));
  return {
    correct: rows.filter((row) => row.actual === row.predicted).length,
    total: rows.length,
    accuracy: rows.filter((row) => row.actual === row.predicted).length / rows.length,
    perClass,
    confusionMatrix,
    coverage: rows.filter((row) => row.predicted !== "MISSING").length,
  };
}
const role = metric("commercialRole", roleLabels);
const who = metric("who", whoLabels);
assert.deepEqual(report.commercialRole.perClass, role.perClass);
assert.deepEqual(report.commercialRole.confusionMatrix, role.confusionMatrix);
assert.equal(report.commercialRole.correct, role.correct);
assert.equal(report.commercialRole.accuracy, role.accuracy);
assert.deepEqual(report.who.perClass, who.perClass);
assert.deepEqual(report.who.confusionMatrix, who.confusionMatrix);
assert.equal(report.who.correct, who.correct);
assert.equal(report.who.accuracy, who.accuracy);
assert.equal(report.coverage.commercialRoleDecision.count, role.coverage);
assert.equal(report.coverage.whoDecision.count, who.coverage);

const competitorRows = predictionsDocument.predictions.filter((row) =>
  goldById.get(row.holdoutCompanyId).commercialRole === "SELLER_COMPETITOR");
const safety = {
  goldCompetitors: competitorRows.length,
  correctlyDetectedCompetitors: competitorRows.filter((row) => row.commercialRole?.value === "SELLER_COMPETITOR").length,
  dangerousCompetitorToBuyer: competitorRows.filter((row) => row.commercialRole?.value === "POTENTIAL_BUYER").length,
  competitorsInPositiveBuyerShortlist: competitorRows.filter((row) =>
    row.who?.value === "LIKELY_FIT" || row.who?.value === "POSSIBLE_FIT").length,
  unresolvedCompetitors: competitorRows.filter((row) => !row.commercialRole?.value).length,
};
for (const [key, value] of Object.entries(safety)) assert.equal(report.competitorSafety[key], value, `safety ${key}`);

const usage = predictionsDocument.predictions.flatMap((row) => row.providerUsage ?? []);
assert.equal(usage.length, report.runtimeCost.externalProviderCalls);
assert.equal(usage.reduce((sum, row) => sum + (row.actualCost ?? 0), 0), report.runtimeCost.providerActualCostUsd);
assert.equal(Math.max(...predictionsDocument.predictions.map((row) => row.providerUsage?.length ?? 0)),
  report.runtimeCost.maximumObservedProviderCallsPerCompany);
assert.equal(predictionsDocument.predictions.filter((row) => row.status === "FAILED_ONCE").length, report.coverage.failedOnce);
assert.equal(predictionsDocument.predictions.filter((row) => row.error?.includes("claimBindings")).length,
  report.failureAnalysis.missingCommercialRoleClaimBindings);
assert.equal(predictionsDocument.predictions.filter((row) => row.error?.includes("\"code\": \"too_big\"")).length,
  report.failureAnalysis.additionalCommercialRoleReasonTooLong);

assert.equal(final.hashes.frozenImplementationManifest, expected.freeze);
assert.equal(final.hashes.predictions, expected.predictions);
assert.equal(final.hashes.gold, expected.gold);
assert.equal(final.historicalRegression.commercialRole.correct, role.correct);
assert.equal(final.historicalRegression.who.correct, who.correct);
assert.equal(final.historicalRegression.commercialRole.coverage, role.coverage);
assert.equal(final.historicalRegression.who.coverage, who.coverage);
assert.deepEqual(final.historicalRegression.competitorSafety, safety);
assert.equal(final.providerAndSemanticUsage.externalProviderCalls, usage.length);
assert.equal(final.providerAndSemanticUsage.actualProviderCostUsd, report.runtimeCost.providerActualCostUsd);
assert.equal(final.architecture.verdict, report.architectureVerdict);
assert.equal(report.finalArchitectureReview.status, "FAIL");
assert.equal(report.finalArchitectureReview.reportIntegrity, "PASS");
assert.equal(final.finalArchitectureReview.status, report.finalArchitectureReview.status);
assert.equal(final.finalArchitectureReview.reportIntegrity, report.finalArchitectureReview.reportIntegrity);
assert.deepEqual(
  final.finalArchitectureReview.findings.map((finding) => finding.code),
  report.finalArchitectureReview.boundedDefects.map((finding) => finding.code),
);
assert(report.finalArchitectureReview.boundedDefects.some((finding) =>
  finding.code === "SAFETY_OVERRIDE_PROVENANCE_NOT_REVALIDATED" &&
  finding.description.includes("applySafetyRulesV2") &&
  finding.description.includes("revalidating the final assessment")));
for (const recommendation of [report.specificRecommendation, final.specificRecommendation]) {
  assert(recommendation.includes("(1) align the live combined semantic schema with required claimBindings and reason limits"));
  assert(recommendation.includes("(2) make all four deterministic overrides provenance-preserving and validate the final output"));
  assert(recommendation.includes("generic zero-provider fixtures"));
  assert(recommendation.includes("new untouched evaluation that is not Holdout V2"));
}
assert.equal(final.productionStatus.productionDefault, "V1");
assert.equal(report.nextStep, "V2 is simpler but has not yet met the product threshold. Do not add architectural complexity; inspect only the remaining bounded failure.");

const markdown = await readFile(new URL(paths.markdown, root), "utf8");
for (const text of [expected.freeze, expected.predictions, expected.gold, "0/16 (0.0%)", "86 provider calls",
  "$1.024853592942899", report.architectureVerdict, "Final architecture review:** FAIL",
  "Report integrity:** PASS", "applySafetyRulesV2", "all four deterministic overrides",
  "new untouched evaluation that is not Holdout V2", report.nextStep]) {
  assert(markdown.includes(text), `markdown consistency: ${text}`);
}

const freezeValidation = spawnSync("node", ["evaluations/jyra-intelligence-v2/validate-task-117-freeze.mjs"], {
  cwd: root, encoding: "utf8",
});
process.stdout.write(freezeValidation.stdout);
process.stderr.write(freezeValidation.stderr);
assert.equal(freezeValidation.status, 0, "frozen generic validator failed");
for (const file of freeze.files) {
  assert.equal(sha256(await bytes(file.path)), file.sha256, `frozen implementation changed during final validation: ${file.path}`);
}
assert.equal(sha256(await bytes(paths.predictions)), expected.predictions, "prediction changed during final validation");
assert.equal(sha256(await bytes(paths.gold)), expected.gold, "gold changed during final validation");
console.log("TASK 117 FINAL VALIDATION PASS");