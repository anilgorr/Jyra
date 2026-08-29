import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-recommendation-ledger-test.cjs";
await build({
  entryPoints: ["./scripts/recommendation-ledger-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});

const require = createRequire(import.meta.url);
const {
  appendRecommendationOutcome,
  assertLedgerUpdateRejected,
  findLedgerTestTarget,
  getNextBestActionForCompany,
  getRecommendationLedgerEntry,
  listRecommendationLedger,
  RECOMMENDATION_OUTCOME_REASONS,
  RECOMMENDATION_OUTCOME_TYPES,
  testOutcomeLinkAndImmutabilityInRollback,
} = require(output);

assert.deepEqual(RECOMMENDATION_OUTCOME_TYPES, [
  "USEFUL", "NOT_USEFUL", "CONTACTED", "POSITIVE_REPLY", "NEGATIVE_REPLY",
  "MEETING", "QUALIFIED", "PROPOSAL", "WON", "LOST",
]);
assert.equal(RECOMMENDATION_OUTCOME_TYPES.includes("SKIPPED"), false);
assert.equal(RECOMMENDATION_OUTCOME_REASONS.includes("BAD_DATA"), true);
assert.equal(RECOMMENDATION_OUTCOME_REASONS.includes("COMPETITOR"), true);

const target = await findLedgerTestTarget();
assert.ok(target, "A persisted opportunity and organization member are required for the ledger integration test");

const first = await getNextBestActionForCompany(target.projectId, target.projectCompanyId);
const second = await getNextBestActionForCompany(target.projectId, target.projectCompanyId);
assert.ok(first?.recommendationId);
assert.equal(second?.recommendationId, first.recommendationId, "Repeated reads must reuse the same immutable snapshot");

const entries = await listRecommendationLedger(target.projectId, target.projectCompanyId);
const entry = entries.find((candidate) => candidate.id === first.recommendationId);
assert.ok(entry);
assert.equal(entry.projectCompanyId, target.projectCompanyId);
assert.equal(entry.companyId, target.companyId);
assert.equal(entry.opportunityModelVersionId, target.modelVersionId);
assert.equal(entry.opportunityModelVersion, target.modelVersion);
assert.equal(entry.recommendedAction, first.recommendation.action);
assert.equal(entry.fit, first.recommendation.factors.fitScore);
assert.equal(entry.need, first.recommendation.factors.needScore);
assert.equal(entry.timing, first.recommendation.factors.timingScore);
assert.equal(entry.relationship, first.recommendation.factors.relationshipScore);
assert.equal(entry.confidence, first.recommendation.factors.confidenceScore);
assert.ok(Array.isArray(entry.signals));
assert.ok(Array.isArray(entry.clusters));
assert.ok(Array.isArray(entry.evidenceReferences));
assert.ok(entry.why);

const detail = await getRecommendationLedgerEntry(target.projectId, first.recommendationId);
assert.equal(detail?.id, first.recommendationId);
assert.equal(await getRecommendationLedgerEntry(randomUUID(), first.recommendationId), null);
assert.equal(await appendRecommendationOutcome({
  recommendationId: first.recommendationId,
  organizationId: randomUUID(),
  projectId: target.projectId,
  outcomeType: "USEFUL",
  recordedBy: target.userId,
}), null);

assert.equal(await assertLedgerUpdateRejected(first.recommendationId), true);
assert.deepEqual(
  await testOutcomeLinkAndImmutabilityInRollback({
    recommendationId: first.recommendationId,
    userId: target.userId,
  }),
  { linked: true, immutable: true },
);

console.log("Recommendation ledger tests passed.");
process.exit(0);