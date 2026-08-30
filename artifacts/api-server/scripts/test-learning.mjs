import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-learning-test.cjs";
await build({
  entryPoints: ["./scripts/learning-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});

const require = createRequire(import.meta.url);
const {
  DEFAULT_OUTCOME_WEIGHTS,
  buildIcpAssumptionProposal,
  db,
  getLearningAnalytics,
  outcomeStrength,
  recommendationLedgerTable,
  summarizeMetric,
  updateLearningPolicy,
} = require(output);

assert.ok(outcomeStrength("WON") > outcomeStrength("QUALIFIED"));
assert.ok(outcomeStrength("QUALIFIED") > outcomeStrength("MEETING"));
assert.ok(outcomeStrength("MEETING") > outcomeStrength("POSITIVE_REPLY"));
assert.ok(outcomeStrength("POSITIVE_REPLY") > outcomeStrength("CONTACTED"));
assert.equal(outcomeStrength("SKIPPED"), 0);
assert.equal(outcomeStrength("VIEWED"), 0);

assert.equal(buildIcpAssumptionProposal([], 1), null);
const icpProposal = buildIcpAssumptionProposal([
  "Early outcomes suggest companies in the 51-200 range are responding more positively.",
  "This is an evidence-backed association, not proof of causality.",
], 3);
assert.equal(icpProposal?.proposalType, "CHANGE_ICP_ASSUMPTION");
assert.equal(icpProposal?.evidenceSnapshot.sourcePolicyVersion, 3);
assert.equal(icpProposal?.evidenceSnapshot.associationOnly, true);

const now = new Date();
const recommendation = {
  id: "11111111-1111-4111-8111-111111111111",
  opportunityModelVersionId: "22222222-2222-4222-8222-222222222222",
};
const summary = summarizeMetric([
  {
    recommendation,
    outcomes: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        outcomeType: "CONTACTED",
        recordedAt: now,
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        outcomeType: "MEETING",
        recordedAt: now,
      },
    ],
  },
  {
    recommendation: { ...recommendation, id: "55555555-5555-4555-8555-555555555555" },
    outcomes: [],
  },
], {
  id: null,
  version: 1,
  outcomeWeights: DEFAULT_OUTCOME_WEIGHTS,
  minimumObservedSample: 2,
  minimumPositiveOutcomes: 2,
});
assert.equal(summary.sampleSize, 2);
assert.equal(summary.observedOutcomeCount, 1);
assert.equal(summary.meetingRate, 1);
assert.equal(summary.qualificationRate, 0);
assert.equal(summary.weightedOutcomeScore, DEFAULT_OUTCOME_WEIGHTS.MEETING);
assert.match(summary.associationNote, /Insufficient evidence/);

const [target] = await db.select().from(recommendationLedgerTable).limit(1);
if (target) {
  const policy = await updateLearningPolicy({
    organizationId: target.organizationId,
    scope: "PROJECT",
    projectId: target.projectId,
    outcomeWeights: { ...DEFAULT_OUTCOME_WEIGHTS, CONTACTED: 0.2 },
    minimumObservedSample: 2,
    minimumPositiveOutcomes: 1,
    createdBy: (
      await db.query.organizationMembersTable.findFirst({
        where: (members, { eq }) => eq(members.organizationId, target.organizationId),
      })
    )?.userId,
  });
  assert.equal(policy.outcomeWeights.CONTACTED, 0.2);
  const analytics = await getLearningAnalytics({
    organizationId: target.organizationId,
    scope: "PROJECT",
    projectId: target.projectId,
  });
  assert.equal(analytics.scopeKey, `PROJECT:${target.projectId}`);
  assert.match(analytics.associationWarning, /do not prove/i);
  assert.ok(analytics.metrics.every((metric) => metric.policyVersion === policy.version));
}

console.log("Continuous learning tests passed.");
process.exit(0);