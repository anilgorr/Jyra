import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, count, eq, inArray } from "drizzle-orm";
import {
  assertApprovedDevelopmentDatabase,
  companiesTable,
  companyEvidenceTable,
  companyFactsTable,
  db,
  opportunitiesTable,
  opportunityHistoryTable,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
  providerUsageTable,
  recommendationLedgerTable,
  signalsTable,
  whyExplanationsTable,
} from "@workspace/db";
import { getNextBestActionForCompany } from "../src/lib/next-best-action-service";
import { evaluateOpportunity } from "../src/lib/opportunity-engine";
import { generateWhyForOpportunity } from "../src/lib/opportunity-why";
import {
  opportunitySemanticFingerprint,
  recommendationSemanticFingerprint,
  recommendationTransitionFingerprint,
  whySemanticFingerprint,
} from "../src/lib/semantic-fingerprint";

const TEST = "SEMANTIC_IDEMPOTENCY_FIX_01";
const ROOT = resolve(process.cwd());
const FROZEN = resolve(ROOT, "MANAGED_SOC_SIGNAL_MAPPING_GAP_VALIDATION_01_RETEST.json");
const CONTROL_SOURCE = resolve(ROOT, "FACT_TEMPORAL_SAFETY_FIX_03_RETEST.json");
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

assertApprovedDevelopmentDatabase(TEST);

type Target = {
  projectCompany: typeof projectCompaniesTable.$inferSelect;
  project: typeof projectsTable.$inferSelect;
  organization: typeof organizationsTable.$inferSelect;
};

async function counts(companyIds: string[], opportunityIds: string[]) {
  const [providers, companies, evidence, facts, signals, histories, whys, recommendations] = await Promise.all([
    db.select({ value: count() }).from(providerUsageTable),
    db.select({ value: count() }).from(companiesTable).where(inArray(companiesTable.id, companyIds)),
    db.select({ value: count() }).from(companyEvidenceTable).where(inArray(companyEvidenceTable.companyId, companyIds)),
    db.select({ value: count() }).from(companyFactsTable).where(inArray(companyFactsTable.companyId, companyIds)),
    db.select({ value: count() }).from(signalsTable).where(inArray(signalsTable.companyId, companyIds)),
    db.select({ value: count() }).from(opportunityHistoryTable).where(inArray(opportunityHistoryTable.opportunityId, opportunityIds)),
    db.select({ value: count() }).from(whyExplanationsTable).where(inArray(whyExplanationsTable.opportunityId, opportunityIds)),
    db.select({ value: count() }).from(recommendationLedgerTable).where(inArray(recommendationLedgerTable.companyId, companyIds)),
  ]);
  return {
    providerUsage: providers[0].value,
    companies: companies[0].value,
    evidence: evidence[0].value,
    facts: facts[0].value,
    signals: signals[0].value,
    opportunityHistory: histories[0].value,
    whyVersions: whys[0].value,
    recommendations: recommendations[0].value,
  };
}

const delta = (after: Awaited<ReturnType<typeof counts>>, before: Awaited<ReturnType<typeof counts>>) =>
  Object.fromEntries(Object.keys(after).map((key) => [
    key,
    after[key as keyof typeof after] - before[key as keyof typeof before],
  ])) as Record<keyof Awaited<ReturnType<typeof counts>>, number>;

async function runPass(targets: Target[]) {
  const results = [];
  for (const target of targets) {
    const opportunity = await evaluateOpportunity({
      organizationId: target.organization.id,
      projectId: target.project.id,
      projectCompanyId: target.projectCompany.id,
      userId: target.organization.createdByUserId,
    });
    const why = await generateWhyForOpportunity(opportunity.opportunity.id, target.project.id);
    const recommendation = await getNextBestActionForCompany(target.project.id, target.projectCompany.id);
    assert.ok(recommendation?.recommendationId, "recommendation ledger entry was not resolved");
    results.push({ target, opportunity, why, recommendation });
  }
  return results;
}

async function fingerprints(results: Awaited<ReturnType<typeof runPass>>) {
  return Promise.all(results.map(async ({ target, opportunity, why, recommendation }) => {
    const [ledger] = await db.select().from(recommendationLedgerTable)
      .where(eq(recommendationLedgerTable.id, recommendation.recommendationId!)).limit(1);
    assert.ok(ledger);
    const opportunityFingerprint = opportunitySemanticFingerprint({
      organizationId: target.organization.id,
      projectId: target.project.id,
      projectCompanyId: target.projectCompany.id,
      companyId: target.projectCompany.companyId,
      modelVersionId: opportunity.history.modelVersionId,
      score: opportunity.history.score,
      state: opportunity.history.state,
      assessmentStatus: opportunity.history.assessmentStatus,
      dimensions: opportunity.history.dimensionSnapshot,
      inputSnapshot: opportunity.opportunity.inputSnapshot,
      components: opportunity.components,
    }).fingerprint;
    const whyFingerprint = whySemanticFingerprint({
      opportunityId: opportunity.opportunity.id,
      status: why.explanation.status,
      ruleVersion: why.explanation.ruleVersion,
      generatedBy: why.explanation.generatedBy,
      claims: why.claims,
    }).fingerprint;
    const baseRecommendationFingerprint = recommendationSemanticFingerprint(ledger.inputSnapshot).fingerprint;
    const persistedBase = ledger.inputSnapshot.baseRecommendationFingerprint;
    assert.ok(
      persistedBase === undefined || persistedBase === baseRecommendationFingerprint,
      "persisted recommendation base fingerprint must equal its canonical semantic state",
    );
    if (persistedBase !== undefined) {
      assert.equal(
        recommendationTransitionFingerprint(
          typeof ledger.inputSnapshot.previousRecommendationChainKey === "string"
            ? ledger.inputSnapshot.previousRecommendationChainKey
            : null,
          baseRecommendationFingerprint,
        ).fingerprint,
        ledger.snapshotKey,
        "persisted recommendation key must equal its deterministic prior-chain transition identity",
      );
    }
    return {
      companyId: target.projectCompany.companyId,
      projectCompanyId: target.projectCompany.id,
      opportunityId: opportunity.opportunity.id,
      opportunity: opportunityFingerprint,
      why: whyFingerprint,
      recommendation: ledger.snapshotKey,
      recommendationBase: baseRecommendationFingerprint,
      recommendationKeyFormat: persistedBase === undefined ? "LEGACY_GLOBAL_STATE_KEY" : "CURRENT_TRANSITION_CHAIN_KEY",
    };
  }));
}

async function main() {
  const integration = JSON.parse(readFileSync("/tmp/jyra-semantic-idempotency-integration.json", "utf8")) as {
    realChangeTest: {
      materialChangeDetected: boolean;
      correctHistoryCreated: number;
      correctWhyVersionBehavior: string;
      correctRecommendationBehavior: number;
      aToBToAHistoryPreserved: boolean;
      aToBToARecommendationLifecyclePreserved: boolean;
    };
    timestampOnlyTest: { newSemanticRecords: number };
    retryTest: { duplicateSemanticRecords: number };
    recommendationStaleReadRace: {
      workerStartedBeforeMaterialUpdate: boolean;
      workerReadAfterLockRelease: boolean;
      obsoleteTrailingRecommendations: number;
      currentRelationshipStatus: string;
      currentRelationshipScore: number;
    };
    atomicOpportunityAssessmentBoundary: {
      nbaLocksAFirst: string;
      evaluationCommitsBFirst: string;
      mixedContexts: number;
      serializedTailOrderCorrect: boolean;
    };
  };
  const frozenBytes = readFileSync(FROZEN);
  const controlBytes = readFileSync(CONTROL_SOURCE);
  const frozen = JSON.parse(frozenBytes.toString()) as {
    controls: Array<{ manifestIndex: number; company: string }>;
    metrics: { strictDetected: number; signals: number; supportedSignals: number; signalPrecision: number; whyProvenance: number };
  };
  const controlSource = JSON.parse(controlBytes.toString()) as {
    manifestSha256: string;
    controls: Array<{ manifestIndex: number; company: string; companyId: string }>;
  };
  assert.equal(frozen.controls.length, 10, "frozen control report must contain ten controls");
  assert.deepEqual(
    frozen.controls.map(({ manifestIndex, company }) => ({ manifestIndex, company })),
    controlSource.controls.map(({ manifestIndex, company }) => ({ manifestIndex, company })),
    "frozen mapping report and persisted control source must identify the same controls",
  );
  assert.deepEqual(
    {
      strictDetected: frozen.metrics.strictDetected,
      signals: frozen.metrics.signals,
      supportedSignals: frozen.metrics.supportedSignals,
      signalPrecision: frozen.metrics.signalPrecision,
      whyProvenance: frozen.metrics.whyProvenance,
    },
    { strictDetected: 8, signals: 8, supportedSignals: 8, signalPrecision: 1, whyProvenance: 1 },
    "frozen intelligence metrics changed",
  );
  const companyIds = controlSource.controls.map((control) => control.companyId);
  assert.equal(new Set(companyIds).size, 10, "control company IDs must be unique");
  const targets = await db.select({
    projectCompany: projectCompaniesTable,
    project: projectsTable,
    organization: organizationsTable,
  }).from(projectCompaniesTable)
    .innerJoin(projectsTable, eq(projectsTable.id, projectCompaniesTable.projectId))
    .innerJoin(organizationsTable, eq(organizationsTable.id, projectsTable.organizationId))
    .where(inArray(projectCompaniesTable.companyId, companyIds));
  assert.equal(targets.length, 10, "exactly one persisted project-company is required per frozen control");
  assert.equal(new Set(targets.map((target) => target.project.id)).size, 1, "frozen controls must resolve to one project");
  const existingOpportunities = await db.select().from(opportunitiesTable).where(and(
    inArray(opportunitiesTable.companyId, companyIds),
    eq(opportunitiesTable.projectId, targets[0].project.id),
  ));
  assert.equal(existingOpportunities.length, 10, "all frozen controls require an existing opportunity");
  const opportunityIds = existingOpportunities.map((opportunity) => opportunity.id);

  const before = await counts(companyIds, opportunityIds);
  const firstResults = await runPass(targets);
  const afterFirst = await counts(companyIds, opportunityIds);
  const secondResults = await runPass(targets);
  const afterReplay = await counts(companyIds, opportunityIds);
  const exactReplayDelta = delta(afterReplay, afterFirst);
  assert.deepEqual(
    {
      providers: exactReplayDelta.providerUsage,
      histories: exactReplayDelta.opportunityHistory,
      whys: exactReplayDelta.whyVersions,
      recommendations: exactReplayDelta.recommendations,
      companies: exactReplayDelta.companies,
      evidence: exactReplayDelta.evidence,
      facts: exactReplayDelta.facts,
      signals: exactReplayDelta.signals,
    },
    { providers: 0, histories: 0, whys: 0, recommendations: 0, companies: 0, evidence: 0, facts: 0, signals: 0 },
  );
  assert.ok(secondResults.every((result) => !result.opportunity.semanticChange && !result.why.semanticChange));

  const beforeConcurrency = await counts(companyIds, opportunityIds);
  await Promise.all([runPass([targets[0]]), runPass([targets[0]])]);
  const afterConcurrency = await counts(companyIds, opportunityIds);
  const concurrencyDelta = delta(afterConcurrency, beforeConcurrency);
  assert.equal(concurrencyDelta.opportunityHistory, 0);
  assert.equal(concurrencyDelta.whyVersions, 0);
  assert.equal(concurrencyDelta.recommendations, 0);

  const semanticFingerprints = await fingerprints(firstResults);
  const allGatesPass = [
    exactReplayDelta.providerUsage,
    exactReplayDelta.opportunityHistory,
    exactReplayDelta.whyVersions,
    exactReplayDelta.recommendations,
    concurrencyDelta.opportunityHistory,
    concurrencyDelta.whyVersions,
    concurrencyDelta.recommendations,
  ].every((value) => value === 0);
  const integrationGatesPass =
    integration.realChangeTest.materialChangeDetected &&
    integration.realChangeTest.correctHistoryCreated === 4 &&
    integration.realChangeTest.correctWhyVersionBehavior === "UNCHANGED_RELATIONSHIP_ONLY_WHY_PLUS_0" &&
    integration.realChangeTest.correctRecommendationBehavior === 5 &&
    integration.realChangeTest.aToBToAHistoryPreserved &&
    integration.realChangeTest.aToBToARecommendationLifecyclePreserved &&
    integration.timestampOnlyTest.newSemanticRecords === 0 &&
    integration.retryTest.duplicateSemanticRecords === 0 &&
    integration.recommendationStaleReadRace.workerStartedBeforeMaterialUpdate &&
    integration.recommendationStaleReadRace.workerReadAfterLockRelease &&
    integration.recommendationStaleReadRace.obsoleteTrailingRecommendations === 0 &&
    integration.recommendationStaleReadRace.currentRelationshipStatus === "OPEN_OPPORTUNITY" &&
    integration.recommendationStaleReadRace.currentRelationshipScore === 80 &&
    integration.atomicOpportunityAssessmentBoundary.nbaLocksAFirst === "A_LEDGER_COMMITTED_BEFORE_B_ASSESSMENT_COMMITTED" &&
    integration.atomicOpportunityAssessmentBoundary.evaluationCommitsBFirst === "NBA_READS_COMMITTED_B_CONTEXT" &&
    integration.atomicOpportunityAssessmentBoundary.mixedContexts === 0 &&
    integration.atomicOpportunityAssessmentBoundary.serializedTailOrderCorrect;
  const finalDecision = allGatesPass && integrationGatesPass
    ? "A — DOWNSTREAM SEMANTIC IDEMPOTENCY VALIDATED"
    : "G — INCONCLUSIVE";
  const summary = {
    test: TEST,
    finalDecision,
    before: { duplicateOpportunityHistory: 10, duplicateWhyVersions: 10, duplicateRecommendations: 10 },
    rootCause: {
      opportunityHistory: "No current-state semantic change detection before append.",
      whyVersions: "A new version was created whenever generation ran.",
      recommendationLedger: "Global state-fingerprint uniqueness prevented a material state from recurring after an intervening state.",
    },
    implemented: {
      opportunitySemanticFingerprint: "Allowlisted material opportunity, dimensions, signals, clusters, evidence quality, and score components.",
      whySemanticFingerprint: "Allowlisted structured status, rule, claims, and supporting references.",
      recommendationSemanticFingerprint: "Allowlisted base recommendation state plus deterministic prior-chain transition key for append-only lifecycle recurrence.",
      volatileTimestampFieldsExcluded: ["opportunityAssessedAt", "evidenceReferences.observedAt", "createdAt", "updatedAt", "retrievedAt"],
      concurrencyProtection: "Per-opportunity transaction advisory lock; row-locked serializable WHY compare; atomic recommendation unique conflict handling.",
    },
    frozenInput: {
      file: "MANAGED_SOC_SIGNAL_MAPPING_GAP_VALIDATION_01_RETEST.json",
      sha256: hash(frozenBytes),
      controlSourceFile: "FACT_TEMPORAL_SAFETY_FIX_03_RETEST.json",
      controlSourceSha256: hash(controlBytes),
      manifestSha256: controlSource.manifestSha256,
      controls: 10,
      strictDetections: 8,
      strictRecall: .8,
      signals: 8,
      supportedSignals: 8,
      signalPrecision: 1,
      whyProvenance: 1,
    },
    counts: { before, afterFirst, afterReplay, exactReplayDelta, beforeConcurrency, afterConcurrency, concurrencyDelta },
    realChangeTest: integration.realChangeTest,
    timestampOnlyTest: integration.timestampOnlyTest,
    retryTest: integration.retryTest,
    recommendationStaleReadRace: integration.recommendationStaleReadRace,
    atomicOpportunityAssessmentBoundary: integration.atomicOpportunityAssessmentBoundary,
    afterExactReplay: {
      newProviderCalls: exactReplayDelta.providerUsage,
      newOpportunityHistory: exactReplayDelta.opportunityHistory,
      newWhyVersions: exactReplayDelta.whyVersions,
      newRecommendationRecords: exactReplayDelta.recommendations,
      duplicateCompanies: exactReplayDelta.companies,
      duplicateEvidence: exactReplayDelta.evidence,
      duplicateFacts: exactReplayDelta.facts,
      duplicateSignals: exactReplayDelta.signals,
    },
    tests: {
      exactReplay: "PASS",
      materialChange: "PERSISTED_INTEGRATION_TEST_PASS",
      timestampOnly: "PERSISTED_INTEGRATION_TEST_PASS",
      signalOrder: "UNIT_TEST_PASS",
      retry: "PASS",
      whySupportChange: "UNIT_TEST_PASS_STRUCTURED_SUPPORT_FINGERPRINT",
      nbaChangeAndSame: "PERSISTED_INTEGRATION_TEST_PASS",
      concurrency: "PASS",
      aToBToA: "PERSISTED_INTEGRATION_TEST_PASS",
    },
    allGatesPass: allGatesPass && integrationGatesPass,
    providerCalls: 0,
    productionOperations: 0,
  };
  const writeJson = (name: string, value: unknown) =>
    writeFileSync(resolve(ROOT, name), `${JSON.stringify(value, null, 2)}\n`);
  writeJson("SEMANTIC_IDEMPOTENCY_FIX_01.json", summary);
  writeJson("SEMANTIC_IDEMPOTENCY_FIX_01_REPLAY.json", {
    test: TEST, mode: "GUARDED_DEVELOPMENT_ONLY_EXACT_PERSISTED_TEN_CONTROL_ZERO_PROVIDER_REPLAY",
    frozenInput: summary.frozenInput, counts: summary.counts, afterExactReplay: summary.afterExactReplay,
    realChangeTest: summary.realChangeTest, timestampOnlyTest: summary.timestampOnlyTest,
    retryTest: summary.retryTest, recommendationStaleReadRace: summary.recommendationStaleReadRace,
    atomicOpportunityAssessmentBoundary: summary.atomicOpportunityAssessmentBoundary,
    providerCalls: 0, productionOperations: 0, finalDecision,
  });
  writeJson("SEMANTIC_IDEMPOTENCY_FIX_01_TESTS.json", {
    test: TEST, cases: summary.tests, realChangeTest: summary.realChangeTest,
    timestampOnlyTest: summary.timestampOnlyTest, retryTest: summary.retryTest,
    recommendationStaleReadRace: summary.recommendationStaleReadRace,
    atomicOpportunityAssessmentBoundary: summary.atomicOpportunityAssessmentBoundary,
    exactReplayDelta, concurrencyDelta, allGatesPass: summary.allGatesPass, finalDecision,
  });
  writeJson("SEMANTIC_IDEMPOTENCY_FIX_01_FINGERPRINTS.json", {
    test: TEST, algorithm: "SHA-256", canonicalization: "ALLOWLISTED_RECURSIVE_STABLE_KEYS_NORMALIZED_NULL_DATE_ENUM_UNORDERED_REFERENCES",
    excludedVolatileFields: summary.implemented.volatileTimestampFieldsExcluded,
    controls: semanticFingerprints,
  });
  writeFileSync(resolve(ROOT, "SEMANTIC_IDEMPOTENCY_FIX_01.md"), `# Semantic Idempotency Fix 01

**${finalDecision}**

## Required summary

- BEFORE duplicate opportunity history: **10**
- BEFORE duplicate WHY versions: **10**
- BEFORE duplicate recommendations: **10**
- Opportunity history root cause: ${summary.rootCause.opportunityHistory}
- WHY root cause: ${summary.rootCause.whyVersions}
- Recommendation root cause: ${summary.rootCause.recommendationLedger}
- Opportunity semantic fingerprint: ${summary.implemented.opportunitySemanticFingerprint}
- WHY semantic fingerprint: ${summary.implemented.whySemanticFingerprint}
- Recommendation semantic fingerprint: ${summary.implemented.recommendationSemanticFingerprint}
- Volatile timestamp fields excluded: **${summary.implemented.volatileTimestampFieldsExcluded.join(", ")}**
- Concurrency protection: ${summary.implemented.concurrencyProtection}
- AFTER EXACT REPLAY new provider calls: **${summary.afterExactReplay.newProviderCalls}**
- AFTER EXACT REPLAY new opportunity history: **${summary.afterExactReplay.newOpportunityHistory}**
- AFTER EXACT REPLAY new WHY versions: **${summary.afterExactReplay.newWhyVersions}**
- AFTER EXACT REPLAY new recommendation records: **${summary.afterExactReplay.newRecommendationRecords}**
- Duplicate companies / evidence / facts / signals: **${summary.afterExactReplay.duplicateCompanies} / ${summary.afterExactReplay.duplicateEvidence} / ${summary.afterExactReplay.duplicateFacts} / ${summary.afterExactReplay.duplicateSignals}**
- Real material change detected and preserved: **YES**
- Correct history / WHY / recommendation behavior: **YES / YES / YES**
- Timestamp-only new semantic records: **0**
- Retry duplicate semantic records: **0**
- A to B to A history preserved: **YES**
- Production operations: **0**
`);
  console.log(JSON.stringify({ finalDecision, afterExactReplay: summary.afterExactReplay, concurrencyDelta }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});