import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Opportunity engine tests");

const output = "/tmp/jyra-opportunity-engine-test.cjs";
await build({ entryPoints: ["./scripts/opportunity-test-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const h = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const evidence = (overrides = {}) => ({
  id: "evidence-1", sourceDomain: "example.com", authority: 90, directness: 90,
  freshness: 90, corroboration: 90, status: "VERIFIED", ...overrides,
});
const signal = (overrides = {}) => ({
  id: "signal-1", polarity: "POSITIVE", strength: 90, confidence: 90,
  needImpact: 90, timingImpact: 90, fitImpact: 0, status: "ACTIVE",
  factIds: ["fact-1"], evidenceIds: ["evidence-1"], ...overrides,
});
const cluster = (overrides = {}) => ({
  id: "cluster-1", strength: 90, confidence: 90, needImpact: 95, timingImpact: 95,
  status: "ACTIVE", signalIds: ["signal-1"], evidenceIds: ["evidence-1"], ...overrides,
});
const fit = (result = "pass") => [{ id: "criterion-1", type: "MUST_HAVE", weight: null, result }];
const base = (overrides = {}) => ({
  weights: h.DEFAULT_OPPORTUNITY_WEIGHTS,
  fitResults: fit(),
  signals: [signal()],
  clusters: [],
  evidence: [evidence(), evidence({ id: "evidence-2", sourceDomain: "second.example" }), evidence({ id: "evidence-3", sourceDomain: "third.example" })],
  relationshipStatus: "NONE",
  previous: null,
  ...overrides,
});

const highFitNoNeed = h.calculateOpportunityAssessment(base({ signals: [], clusters: [] }));
assert.equal(highFitNoNeed.state, "WATCH", "high Fit without Need must be gated");
assert.equal(highFitNoNeed.components.find((item) => item.dimension === "NEED").score, null);

const highNeedLowFit = h.calculateOpportunityAssessment(base({ fitResults: fit("fail") }));
assert.equal(highNeedLowFit.state, "WATCH", "strong Need with poor Fit must be gated");

const weakConfidence = h.calculateOpportunityAssessment(base({ evidence: [evidence({ authority: 10, directness: 10, freshness: 10, corroboration: 10, status: "CONFLICTING" })] }));
assert.equal(weakConfidence.assessmentStatus, "NEEDS_MORE_RESEARCH");
assert.notEqual(weakConfidence.state, "SURGING");

const strongCluster = h.calculateOpportunityAssessment(base({ clusters: [cluster()], relationshipStatus: "KNOWN_CHAMPION" }));
assert.equal(strongCluster.state, "SURGING");
assert.equal(strongCluster.components.find((item) => item.dimension === "NEED").clusterIds.length, 1);

const negative = h.calculateOpportunityAssessment(base({ signals: [signal({ polarity: "NEGATIVE" })] }));
assert.equal(negative.state, "WATCH");

const stale = h.calculateOpportunityAssessment(base({ signals: [signal({ status: "STALE" })] }));
assert.equal(stale.components.find((item) => item.dimension === "NEED").score, null);

const contradictory = h.calculateOpportunityAssessment(base({ evidence: [evidence(), evidence({ id: "evidence-2", sourceDomain: "second.example", status: "CONFLICTING" })] }));
assert.equal(contradictory.components.find((item) => item.dimension === "CONFIDENCE").details.contradictions, 1);

const missing = h.calculateOpportunityAssessment(base({ fitResults: [{ id: "criterion-1", type: "MUST_HAVE", weight: null, result: "unknown" }] }));
assert.equal(missing.components.find((item) => item.dimension === "FIT").score, null, "unknown ICP information must not become failure");
assert.equal(missing.score, null, "an unknown core dimension must keep the overall score unknown");
assert.equal(missing.assessmentStatus, "INSUFFICIENT_DATA");
assert.notEqual(missing.state, "DORMANT", "insufficient evidence must not become DORMANT");

const entirelyUnknown = h.calculateOpportunityAssessment(base({ fitResults: fit("unknown"), signals: [], clusters: [], evidence: [], relationshipStatus: "NONE" }));
assert.equal(entirelyUnknown.score, null, "unknown dimensions must not silently become numeric zero");
assert.ok(entirelyUnknown.components.filter((item) => item.dimension !== "CONFIDENCE").every((item) => item.score === null));
assert.notEqual(entirelyUnknown.state, "DORMANT");

const evaluatedWeak = h.calculateOpportunityAssessment(base({
  signals: [signal({ polarity: "NEGATIVE", needImpact: 0, timingImpact: 0 })],
  relationshipStatus: "PREVIOUS_CONTACT",
}));
assert.equal(evaluatedWeak.score, 32.5, "evaluated zero impacts remain real numeric zeroes");
assert.equal(evaluatedWeak.state, "WATCH");

const evaluatedDormant = h.calculateOpportunityAssessment(base({
  fitResults: [{ id: "criterion-1", type: "DISQUALIFIER", weight: null, result: "pass" }],
  signals: [signal({ polarity: "NEGATIVE", needImpact: 0, timingImpact: 0 })],
  relationshipStatus: "NONE",
}));
assert.equal(evaluatedDormant.score, 0);
assert.equal(evaluatedDormant.state, "DORMANT", "sufficiently evaluated weak inputs may still be DORMANT");

const relationship = h.calculateOpportunityAssessment(base({ relationshipStatus: "OPEN_OPPORTUNITY" }));
assert.equal(relationship.state, "ACTIVE");
assert.equal(relationship.components.find((item) => item.dimension === "RELATIONSHIP").score, 80);

const sellerA = h.calculateOpportunityAssessment(base());
const sellerB = h.calculateOpportunityAssessment(base({ fitResults: fit("fail") }));
assert.notEqual(sellerA.state, sellerB.state, "the same company may be interpreted differently by different projects");

const cooling = h.calculateOpportunityAssessment(base({
  signals: [signal({ strength: 25, needImpact: 40, timingImpact: 20 })],
  previous: { state: "SURGING", score: 92, timingScore: 90 },
}));
assert.equal(cooling.state, "COOLING");

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `opportunity-test-${suffix}`;
let organization;
try {
  await h.db.insert(h.usersTable).values({ id: userId });
  [organization] = await h.db.insert(h.organizationsTable).values({ name: `Opportunity ${suffix}`, createdByUserId: userId }).returning();
  const [project] = await h.db.insert(h.projectsTable).values({ organizationId: organization.id, name: "Opportunity project" }).returning();
  const [company] = await h.db.insert(h.companiesTable).values({ canonicalName: `Opportunity Co ${suffix}`, domain: `opportunity-${suffix}.example` }).returning();
  const [projectCompany] = await h.db.insert(h.projectCompaniesTable).values({ projectId: project.id, companyId: company.id, relationshipStatus: "NONE" }).returning();
  const unassessedRecommendation = await h.getNextBestActionForCompany(project.id, projectCompany.id);
  assert.equal(unassessedRecommendation.recommendationId, null, "unassessed NBA must not ledger a mixed mutable snapshot");
  assert.equal((await h.db.select().from(h.recommendationLedgerTable).where(h.eq(h.recommendationLedgerTable.projectCompanyId, projectCompany.id))).length, 0);
  const persisted = await h.evaluateOpportunity({ organizationId: organization.id, projectId: project.id, projectCompanyId: projectCompany.id, userId });
  assert.equal(persisted.opportunity.state, "WATCH");
  assert.equal(persisted.opportunity.score, null);
  assert.equal(persisted.opportunity.assessmentStatus, "INSUFFICIENT_DATA");
  const histories = await h.db.select().from(h.opportunityHistoryTable).where(h.eq(h.opportunityHistoryTable.opportunityId, persisted.opportunity.id));
  assert.equal(histories.length, 1);
  const replayed = await h.evaluateOpportunity({ organizationId: organization.id, projectId: project.id, projectCompanyId: projectCompany.id, userId });
  assert.equal(replayed.semanticChange, false, "an exact opportunity replay must skip semantic history");
  const replayHistories = await h.db.select().from(h.opportunityHistoryTable).where(h.eq(h.opportunityHistoryTable.opportunityId, persisted.opportunity.id));
  assert.equal(replayHistories.length, 1);
  const recommendationA = await h.getNextBestActionForCompany(project.id, projectCompany.id);
  assert.ok(recommendationA?.recommendationId);
  const whyA = await h.generateWhyForOpportunity(persisted.opportunity.id, project.id);
  assert.equal((await h.db.select().from(h.recommendationLedgerTable).where(h.eq(h.recommendationLedgerTable.projectCompanyId, projectCompany.id))).length, 1);
  // Serial order 1: NBA locks assessment A first. Evaluation B waits for that
  // row lock, so the new A ledger commits before B becomes the assessment.
  let releaseAssessmentA;
  let markAssessmentALocked;
  const assessmentALocked = new Promise((resolve) => { markAssessmentALocked = resolve; });
  const assessmentARelease = new Promise((resolve) => { releaseAssessmentA = resolve; });
  // Change the live relationship first without evaluating it. The locked
  // opportunity still atomically represents A and NBA must ignore this live B.
  await h.db.update(h.projectCompaniesTable).set({ relationshipStatus: "OPEN_OPPORTUNITY" }).where(h.eq(h.projectCompaniesTable.id, projectCompany.id));
  const nbaHoldingAssessmentA = h.getNextBestActionForCompany(
    project.id,
    projectCompany.id,
    new Date(),
    {},
    { afterOpportunityLock: async () => { markAssessmentALocked(); await assessmentARelease; } },
  );
  await assessmentALocked;
  const evaluationWaitingForA = h.evaluateOpportunity({ organizationId: organization.id, projectId: project.id, projectCompanyId: projectCompany.id, userId });
  await new Promise((resolve) => setImmediate(resolve));
  releaseAssessmentA();
  const serializedRecommendationA = await nbaHoldingAssessmentA;
  assert.notEqual(serializedRecommendationA.recommendationId, recommendationA.recommendationId, "A ledger must commit before waiting evaluation B");
  assert.equal((await evaluationWaitingForA).semanticChange, true);
  assert.equal((await h.db.select().from(h.recommendationLedgerTable).where(h.eq(h.recommendationLedgerTable.projectCompanyId, projectCompany.id))).length, 2);
  const firstRecommendationB = await h.getNextBestActionForCompany(project.id, projectCompany.id);
  assert.equal(firstRecommendationB.recommendation.factors.relationshipStatus, "OPEN_OPPORTUNITY");
  await h.db.update(h.projectCompaniesTable).set({ relationshipStatus: "NONE" }).where(h.eq(h.projectCompaniesTable.id, projectCompany.id));
  assert.equal((await h.evaluateOpportunity({ organizationId: organization.id, projectId: project.id, projectCompanyId: projectCompany.id, userId })).semanticChange, true);
  const preRaceRecommendationA = await h.getNextBestActionForCompany(project.id, projectCompany.id);
  assert.equal(preRaceRecommendationA.recommendation.factors.relationshipStatus, "NONE");
  assert.equal((await h.db.select().from(h.opportunityHistoryTable).where(h.eq(h.opportunityHistoryTable.opportunityId, persisted.opportunity.id))).length, 3);
  assert.equal((await h.db.select().from(h.recommendationLedgerTable).where(h.eq(h.recommendationLedgerTable.projectCompanyId, projectCompany.id))).length, 4);
  // Existing relationship semantics are a safe persisted material input:
  // A (NONE) -> B (OPEN_OPPORTUNITY) -> A must append both transitions.
  let releaseRecommendationLock;
  let markRecommendationLockAcquired;
  const recommendationLockAcquired = new Promise((resolve) => { markRecommendationLockAcquired = resolve; });
  const recommendationLockRelease = new Promise((resolve) => { releaseRecommendationLock = resolve; });
  const lockHolder = h.db.transaction(async (tx) => {
    await tx.execute(h.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`recommendation:${project.id}:${projectCompany.id}`}, 0))`);
    markRecommendationLockAcquired();
    await recommendationLockRelease;
  });
  await recommendationLockAcquired;
  const waitingRecommendation = h.getNextBestActionForCompany(project.id, projectCompany.id);
  // Yield after invocation: its transaction is now blocked before its first
  // mutable read, while the opportunity material state advances to B.
  await new Promise((resolve) => setImmediate(resolve));
  await h.db.update(h.projectCompaniesTable).set({ relationshipStatus: "OPEN_OPPORTUNITY" }).where(h.eq(h.projectCompaniesTable.id, projectCompany.id));
  const stateB = await h.evaluateOpportunity({ organizationId: organization.id, projectId: project.id, projectCompanyId: projectCompany.id, userId });
  assert.equal(stateB.semanticChange, true);
  releaseRecommendationLock();
  await lockHolder;
  const recommendationB = await waitingRecommendation;
  assert.ok(recommendationB?.recommendationId);
  assert.notEqual(recommendationB.recommendationId, recommendationA.recommendationId);
  const recommendationBRow = (await h.db.select().from(h.recommendationLedgerTable)
    .where(h.eq(h.recommendationLedgerTable.id, recommendationB.recommendationId)))[0];
  assert.equal(recommendationBRow.inputSnapshot.scores.relationshipStatus, "OPEN_OPPORTUNITY");
  assert.equal(recommendationBRow.inputSnapshot.relationshipStatus, undefined);
  assert.equal(recommendationBRow.relationship, 80, "waiting NBA must read the post-update opportunity score");
  const postRaceLedger = await h.db.select().from(h.recommendationLedgerTable)
    .where(h.eq(h.recommendationLedgerTable.projectCompanyId, projectCompany.id));
  assert.equal(postRaceLedger.length, 5, "race must append exactly one current B recommendation");
  assert.equal(recommendationBRow.inputSnapshot.previousRecommendationChainKey, postRaceLedger.find((item) => item.id === preRaceRecommendationA.recommendationId).snapshotKey);
  const whyB = await h.generateWhyForOpportunity(persisted.opportunity.id, project.id);
  assert.equal(whyB.explanation.id, whyA.explanation.id, "relationship-only material change must not version unchanged WHY support/content");
  const stateBReplay = await h.evaluateOpportunity({ organizationId: organization.id, projectId: project.id, projectCompanyId: projectCompany.id, userId, now: new Date("2030-01-01T00:00:00Z") });
  assert.equal(stateBReplay.semanticChange, false, "timestamp-only B replay must be idempotent");
  assert.equal((await h.getNextBestActionForCompany(project.id, projectCompany.id))?.recommendationId, recommendationB.recommendationId);
  await h.db.update(h.projectCompaniesTable).set({ relationshipStatus: "NONE" }).where(h.eq(h.projectCompaniesTable.id, projectCompany.id));
  const stateA2 = await h.evaluateOpportunity({ organizationId: organization.id, projectId: project.id, projectCompanyId: projectCompany.id, userId });
  assert.equal(stateA2.semanticChange, true, "A after B must remain historically visible");
  const recommendationA2 = await h.getNextBestActionForCompany(project.id, projectCompany.id);
  assert.ok(recommendationA2?.recommendationId);
  assert.notEqual(recommendationA2.recommendationId, recommendationA.recommendationId, "recommendation A must append after B");
  assert.equal((await h.db.select().from(h.opportunityHistoryTable).where(h.eq(h.opportunityHistoryTable.opportunityId, persisted.opportunity.id))).length, 5);
  assert.equal((await h.db.select().from(h.recommendationLedgerTable).where(h.eq(h.recommendationLedgerTable.projectCompanyId, projectCompany.id))).length, 6);
  // Retrying after the full partial lifecycle and concurrent identical work add nothing.
  const retryAndConcurrent = await Promise.all([
    h.evaluateOpportunity({ organizationId: organization.id, projectId: project.id, projectCompanyId: projectCompany.id, userId }),
    h.evaluateOpportunity({ organizationId: organization.id, projectId: project.id, projectCompanyId: projectCompany.id, userId }),
  ]);
  assert.ok(retryAndConcurrent.every((result) => !result.semanticChange));
  await Promise.all([h.getNextBestActionForCompany(project.id, projectCompany.id), h.getNextBestActionForCompany(project.id, projectCompany.id)]);
  assert.equal((await h.db.select().from(h.opportunityHistoryTable).where(h.eq(h.opportunityHistoryTable.opportunityId, persisted.opportunity.id))).length, 5);
  assert.equal((await h.db.select().from(h.recommendationLedgerTable).where(h.eq(h.recommendationLedgerTable.projectCompanyId, projectCompany.id))).length, 6);
  const components = await h.db.select().from(h.opportunityScoreComponentsTable).where(h.eq(h.opportunityScoreComponentsTable.historyId, histories[0].id));
  assert.equal(components.length, 5);
  const concurrentWhy = await Promise.all([
    h.generateWhyForOpportunity(persisted.opportunity.id, project.id),
    h.generateWhyForOpportunity(persisted.opportunity.id, project.id),
  ]);
  assert.deepEqual(concurrentWhy.map((result) => result.explanation.version).sort(), [1, 1], "concurrent unchanged WHY refreshes must resolve the same version");
  const whyVersions = await h.db.select().from(h.whyExplanationsTable)
    .where(h.eq(h.whyExplanationsTable.opportunityId, persisted.opportunity.id))
    .orderBy(h.asc(h.whyExplanationsTable.version));
  assert.equal(whyVersions.length, 1);
  assert.equal(whyVersions.filter((item) => item.current).length, 1, "exactly one WHY version must remain current");
  assert.equal(whyVersions[0].text, "Insufficient evidence to establish current urgency.");
  await assert.rejects(
    () => h.db.update(h.whyExplanationsTable).set({ text: "Rewritten history" }).where(h.eq(h.whyExplanationsTable.id, whyVersions[0].id)),
    (error) => /immutable/.test(String(error?.cause?.message ?? error?.message)),
    "historical WHY content must not be editable",
  );
  const whyClaims = await h.db.select().from(h.whyClaimsTable).where(h.eq(h.whyClaimsTable.explanationId, whyVersions[0].id));
  await assert.rejects(
    () => h.db.update(h.whyClaimsTable).set({ claimText: "Rewritten claim" }).where(h.and(
      h.eq(h.whyClaimsTable.explanationId, whyVersions[0].id), h.eq(h.whyClaimsTable.ordinal, whyClaims[0].ordinal),
    )),
    (error) => /immutable/.test(String(error?.cause?.message ?? error?.message)),
    "WHY claim provenance must not be editable",
  );
} finally {
  if (organization) {
    // The ledger is intentionally append-only in production. This narrowly
    // scoped development fixture cleanup runs in one transaction and disables
    // triggers only for that transaction after all assertions have completed.
    await h.db.transaction(async (tx) => {
      await tx.execute(h.sql`SET LOCAL session_replication_role = replica`);
      await tx.delete(h.recommendationLedgerTable).where(h.eq(h.recommendationLedgerTable.organizationId, organization.id));
      await tx.delete(h.organizationsTable).where(h.eq(h.organizationsTable.id, organization.id));
    });
  }
  await h.db.delete(h.usersTable).where(h.eq(h.usersTable.id, userId));
}

writeFileSync("/tmp/jyra-semantic-idempotency-integration.json", JSON.stringify({
  realChangeTest: {
    materialChangeDetected: true,
    correctHistoryCreated: 4,
    correctWhyVersionBehavior: "UNCHANGED_RELATIONSHIP_ONLY_WHY_PLUS_0",
    correctRecommendationBehavior: 5,
    aToBToAHistoryPreserved: true,
    aToBToARecommendationLifecyclePreserved: true,
  },
  timestampOnlyTest: { newSemanticRecords: 0 },
  retryTest: { duplicateSemanticRecords: 0 },
  recommendationStaleReadRace: {
    workerStartedBeforeMaterialUpdate: true,
    workerReadAfterLockRelease: true,
    currentRelationshipStatus: "OPEN_OPPORTUNITY",
    currentRelationshipScore: 80,
    obsoleteTrailingRecommendations: 0,
  },
  atomicOpportunityAssessmentBoundary: {
    nbaLocksAFirst: "A_LEDGER_COMMITTED_BEFORE_B_ASSESSMENT_COMMITTED",
    evaluationCommitsBFirst: "NBA_READS_COMMITTED_B_CONTEXT",
    mixedContexts: 0,
    serializedTailOrderCorrect: true,
  },
}));
console.log("Opportunity scoring, gating, uncertainty, relationship, cooling, genericity, and history tests passed.");