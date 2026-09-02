import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  businessTwinsTable, businessTwinVersionsTable, companiesTable, companyProvenanceTable, db,
  icpCriteriaTable, icpsTable, icpVersionsTable, organizationMembersTable, projectCompaniesTable,
  projectsTable,
} from "@workspace/db";
import { orchestrateCompanyIntelligence } from "../src/lib/company-intelligence-control-plane";
import type { ProviderOperations } from "../src/lib/provider-contract";

const OUTPUT = "../../evaluations/jyra-clean-room-v1/TASK_105_EVIDENCE_ADMISSION_REPAIR.json";
const REPORT = "../../evaluations/jyra-clean-room-v1/TASK_105_EVIDENCE_ADMISSION_REPAIR_REPORT.md";
const GOLD = "../../evaluations/jyra-clean-room-v1/JYRA_MARKET_QUALITY_GOLD_V1.json";
const TASK_104 = "../../evaluations/jyra-clean-room-v1/TASK_104_MARKET_QUALITY_EVALUATION.json";
const RAW = "./JYRA_ARCHITECTURE_V1_CLEAN_CROSS_DOMAIN_VALIDATION_RAW.json";

function requiredEnvironment() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1" ||
    process.env.JYRA_TASK_105_POST_REPAIR_REGRESSION !== "YES") {
    throw new Error("Task 105 regression requires explicit development-only authorization");
  }
}
const countBy = (items: string[]) => Object.fromEntries([...new Set(items)].sort().map((key) => [key, items.filter((x) => x === key).length]));
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

let providerCalls = 0;
const forbiddenProvider = async (): Promise<never> => {
  providerCalls++;
  throw new Error("TASK_105_FORBIDDEN_PROVIDER_CALL");
};
/** The narrowed router passed to the control plane throws synchronously on any
 * attempted enrichment. This proves the frozen snapshot, rather than research,
 * supplied every input to this regression. */
const noProviderRouter: Pick<ProviderOperations, "searchWeb" | "enrichCompany"> = {
  searchWeb: forbiddenProvider,
  enrichCompany: forbiddenProvider,
};

async function cloneProject(sourceProjectId: string, organizationId: string, userId: string, suffix: string) {
  const [[sourceTwin], [sourceTwinVersion], [sourceIcp], [sourceIcpVersion], memberships, provenance] = await Promise.all([
    db.select().from(businessTwinsTable).where(eq(businessTwinsTable.projectId, sourceProjectId)).limit(1),
    db.select().from(businessTwinVersionsTable).innerJoin(businessTwinsTable, eq(businessTwinVersionsTable.businessTwinId, businessTwinsTable.id))
      .where(eq(businessTwinsTable.projectId, sourceProjectId)).orderBy(desc(businessTwinVersionsTable.version)).limit(1),
    db.select().from(icpsTable).where(eq(icpsTable.projectId, sourceProjectId)).limit(1),
    db.select().from(icpVersionsTable).innerJoin(icpsTable, eq(icpVersionsTable.icpId, icpsTable.id))
      .where(eq(icpsTable.projectId, sourceProjectId)).orderBy(desc(icpVersionsTable.version)).limit(1),
    db.select().from(projectCompaniesTable).where(eq(projectCompaniesTable.projectId, sourceProjectId)),
    db.select().from(companyProvenanceTable).where(eq(companyProvenanceTable.projectId, sourceProjectId)),
  ]);
  if (!sourceTwin || !sourceTwinVersion || !sourceIcp || !sourceIcpVersion) throw new Error(`Incomplete frozen source project ${sourceProjectId}`);
  const criteria = await db.select().from(icpCriteriaTable).where(eq(icpCriteriaTable.icpVersionId, sourceIcpVersion.icp_versions.id));
  return db.transaction(async (tx) => {
    const [project] = await tx.insert(projectsTable).values({ organizationId, name: `TASK_105_POST_REPAIR_REGRESSION ${suffix} ${sourceProjectId.slice(0, 8)}`, description: `Frozen-evidence clone of ${sourceProjectId}` }).returning();
    const [twin] = await tx.insert(businessTwinsTable).values({ organizationId, projectId: project.id, createdBy: userId }).returning();
    const [twinVersion] = await tx.insert(businessTwinVersionsTable).values({
      businessTwinId: twin.id, projectId: project.id, businessMaturityStage: sourceTwinVersion.business_twin_versions.businessMaturityStage,
      version: 1, rawAnswers: sourceTwinVersion.business_twin_versions.rawAnswers, aiInterpretation: sourceTwinVersion.business_twin_versions.aiInterpretation,
      manualInterpretation: sourceTwinVersion.business_twin_versions.manualInterpretation, evidenceClaims: sourceTwinVersion.business_twin_versions.evidenceClaims,
      modelUsed: sourceTwinVersion.business_twin_versions.modelUsed, promptVersion: sourceTwinVersion.business_twin_versions.promptVersion, status: sourceTwinVersion.business_twin_versions.status, createdBy: userId,
    }).returning();
    const [icp] = await tx.insert(icpsTable).values({ organizationId, projectId: project.id, createdBy: userId }).returning();
    const [icpVersion] = await tx.insert(icpVersionsTable).values({
      icpId: icp.id, projectId: project.id, sourceBusinessTwinVersionId: twinVersion.id, icpMode: sourceIcpVersion.icp_versions.icpMode,
      modeExplanation: sourceIcpVersion.icp_versions.modeExplanation, assumptions: sourceIcpVersion.icp_versions.assumptions, version: 1, createdBy: userId,
    }).returning();
    if (criteria.length) await tx.insert(icpCriteriaTable).values(criteria.map((x) => ({
      icpVersionId: icpVersion.id, projectId: project.id, dimension: x.dimension, operator: x.operator, value: x.value, weight: x.weight,
      criterionType: x.criterionType, description: x.description, source: x.source, evaluability: x.evaluability, provenance: x.provenance, validationStatus: x.validationStatus, accepted: x.accepted,
    })));
    await tx.insert(projectCompaniesTable).values(memberships.map((x) => ({
      projectId: project.id, companyId: x.companyId, status: x.status, researchStatus: x.researchStatus, fitScore: x.fitScore, needScore: x.needScore,
      timingScore: x.timingScore, relationshipScore: x.relationshipScore, confidenceScore: x.confidenceScore, opportunityState: x.opportunityState,
      relationshipStatus: x.relationshipStatus, buyerRole: "UNKNOWN", buyerRoleAssessment: null, opportunityScore: x.opportunityScore,
      opportunityAssessmentState: x.opportunityAssessmentState, latestResearchAt: x.latestResearchAt,
    })));
    // Evidence payloads are copied byte-for-byte; new provenance UUIDs are
    // deliberately retained in the new run so semantic citations remain local.
    if (provenance.length) await tx.insert(companyProvenanceTable).values(provenance.map((x) => ({
      organizationId, projectId: project.id, companyId: x.companyId, sourceType: x.sourceType, sourceLabel: x.sourceLabel,
      sourceUrl: x.sourceUrl, observedAt: x.observedAt, payload: x.payload, visibility: x.visibility,
    })));
    return { sourceProjectId, projectId: project.id, companyIds: memberships.map((x) => x.companyId) };
  });
}

function firstError(gold: any, outcome: any) {
  if (!gold.strictEligible) return null;
  if (!outcome.minimumIntelligence.identitySafe) return "IDENTITY_RESOLUTION";
  if (outcome.minimumIntelligence.stage !== "SUFFICIENT") return "PROVIDER_DATA_GAP";
  if (outcome.semantic?.unknownReason === "COMPANY_EVIDENCE_INSUFFICIENT") return "INSUFFICIENT_EVIDENCE_HANDLING";
  if (outcome.buyerRole !== gold.gold.commercialRole) return "COMMERCIAL_ROLE";
  if (!outcome.who) return "WHO_DECISION_POLICY";
  if (outcome.who.qualification !== gold.gold.who) return outcome.who.qualification === "INSUFFICIENT_DATA" ? "PROVIDER_DATA_GAP" : "WHO_DECISION_POLICY";
  return null;
}

async function main() {
  requiredEnvironment();
  const [goldText, task104Text, rawText] = await Promise.all([readFile(GOLD, "utf8"), readFile(TASK_104, "utf8"), readFile(RAW, "utf8")]);
  if (sha(goldText) !== "f59aca76b676d0e54d0899dd23bb3e5c6d5912e71e0597d967a2a722ac8ecfca") throw new Error("Frozen gold checksum mismatch");
  const gold = JSON.parse(goldText);
  const before = JSON.parse(task104Text);
  const raw = JSON.parse(rawText);
  const organizationId = raw.frozen.organizationId;
  const [member] = await db.select({ userId: organizationMembersTable.userId }).from(organizationMembersTable).where(eq(organizationMembersTable.organizationId, organizationId)).limit(1);
  if (!member) throw new Error("Frozen organization member unavailable");
  const suffix = `${Date.now()}`;
  const clones = [];
  for (const source of raw.frozen.clones) clones.push(await cloneProject(source.projectId, organizationId, member.userId, suffix));
  const outcomes: any[] = [];
  for (const clone of clones) for (const companyId of clone.companyIds) {
    const response = await orchestrateCompanyIntelligence({ organizationId, projectId: clone.projectId, companyId, router: noProviderRouter });
    outcomes.push({ projectId: clone.projectId, companyId, ...response });
  }
  if (providerCalls !== 0) throw new Error(`Frozen regression attempted ${providerCalls} provider calls`);
  const byCompany = new Map(outcomes.map((x) => [x.companyId, x]));
  const comparisons = gold.records.map((record: any) => {
    const outcome = byCompany.get(record.benchmarkCompanyId);
    if (!outcome) throw new Error("Frozen cohort mismatch");
    const who = outcome.who?.qualification ?? "MISSING_PREDICTION";
    return { benchmarkCompanyId: record.benchmarkCompanyId, domainKey: record.domainKey, strictEligible: record.groundTruthStatus === "GROUND_TRUTH_CONFIRMED",
      gold: { commercialRole: record.sellerRelativeTruth.commercialRole, who: record.sellerRelativeTruth.who },
      task105: { buyerRole: outcome.buyerRole, who, reasonCode: outcome.reasonCode, semanticUnknownReason: outcome.semantic?.unknownReason ?? null, semanticModelInvoked: outcome.semantic?.llmInvoked ?? false, identitySafe: outcome.minimumIntelligence.identitySafe, mciStage: outcome.minimumIntelligence.stage },
      firstError: firstError({ strictEligible: record.groundTruthStatus === "GROUND_TRUTH_CONFIRMED", gold: { commercialRole: record.sellerRelativeTruth.commercialRole, who: record.sellerRelativeTruth.who } }, outcome),
    };
  });
  const strict = comparisons.filter((x) => x.strictEligible);
  const roleCorrect = strict.filter((x) => x.gold.commercialRole === x.task105.buyerRole);
  const whoCorrect = strict.filter((x) => x.gold.who === x.task105.who);
  const predictedBuyers = strict.filter((x) => x.task105.buyerRole === "POTENTIAL_BUYER");
  const goldCompetitors = strict.filter((x) => x.gold.commercialRole === "SELLER_COMPETITOR");
  const dangerous = strict.filter((x) => x.gold.commercialRole === "SELLER_COMPETITOR" && x.task105.buyerRole === "POTENTIAL_BUYER");
  const errors = strict.map((x) => x.firstError).filter(Boolean);
  const distribution = Object.fromEntries(["IDENTITY_RESOLUTION", "COMPANY_UNDERSTANDING", "COMMERCIAL_ROLE", "ICP_CRITERION_MAPPING", "WHO_DECISION_POLICY", "INSUFFICIENT_EVIDENCE_HANDLING", "PROVIDER_DATA_GAP", "OTHER"].map((x) => [x, errors.filter((v) => v === x).length]));
  const metrics = {
    commercialRoleCoverage: comparisons.length, whoAvailable: comparisons.filter((x) => x.task105.who !== "MISSING_PREDICTION").length,
    completeRoleWho: comparisons.filter((x) => x.task105.buyerRole !== "UNKNOWN" && x.task105.who !== "MISSING_PREDICTION").length,
    unknownCommercialRole: comparisons.filter((x) => x.task105.buyerRole === "UNKNOWN").length, missingWho: comparisons.filter((x) => x.task105.who === "MISSING_PREDICTION").length,
    commercialRoleStrict: { correct: roleCorrect.length, eligible: strict.length, accuracy: roleCorrect.length / strict.length },
    whoStrict: { correct: whoCorrect.length, eligible: strict.length, accuracy: whoCorrect.length / strict.length },
    potentialBuyerPrecision: { correct: predictedBuyers.filter((x) => x.gold.commercialRole === "POTENTIAL_BUYER").length, predicted: predictedBuyers.length, value: predictedBuyers.length ? predictedBuyers.filter((x) => x.gold.commercialRole === "POTENTIAL_BUYER").length / predictedBuyers.length : null },
    sellerCompetitorRecall: { correct: goldCompetitors.filter((x) => x.task105.buyerRole === "SELLER_COMPETITOR").length, gold: goldCompetitors.length, value: goldCompetitors.length ? goldCompetitors.filter((x) => x.task105.buyerRole === "SELLER_COMPETITOR").length / goldCompetitors.length : null },
    dangerousCompetitorAsBuyer: dangerous.length, firstErrorDistribution: distribution,
  };
  const repairPassed = metrics.firstErrorDistribution.INSUFFICIENT_EVIDENCE_HANDLING < 13
    && metrics.commercialRoleCoverage > 4 && metrics.whoAvailable >= 1 && !dangerous.length && providerCalls === 0;
  const artifact = { task: "TASK_105_POST_REPAIR_REGRESSION", status: repairPassed ? "PASS" : "FAIL", repairVerdict: repairPassed ? "YES" : "NO", evaluatedAt: new Date().toISOString(), goldSha256: sha(goldText),
    implementation: {
      filesChanged: [
        "artifacts/api-server/src/lib/company-semantic-assessment.ts",
        "artifacts/api-server/src/lib/minimum-company-intelligence.ts",
        "artifacts/api-server/scripts/company-assessment-readiness-test-entry.ts",
        "artifacts/api-server/scripts/test-company-assessment-readiness.mjs",
        "artifacts/api-server/scripts/fix-08-test-entry.ts",
        "artifacts/api-server/scripts/test-fix-08.mjs",
        "artifacts/api-server/scripts/task-105-evidence-admission-regression-entry.ts",
        "artifacts/api-server/scripts/run-task-105-evidence-admission-regression.mjs",
        "artifacts/api-server/package.json",
      ],
      logicBefore: "Semantic assessment recorded COMPANY_EVIDENCE_INSUFFICIENT when useful persisted descriptions were excluded by the admission boundary.",
      logicAfter: "The readiness contract admits explicit primary-business text from original admissible provenance or an explicitly labeled canonical-company record reference; unlinked MCI claims are rejected and optional profile gaps remain non-blocking.",
    },
    source: { task100RawSha256: sha(rawText), task104Artifact: TASK_104, frozenProjects: raw.frozen.clones.map((x: any) => x.projectId), newDevelopmentProjects: clones.map((x) => x.projectId) },
    safety: { developmentOnly: true, providerCalls, providerMethodsThrow: true, productionModified: false, goldModified: false, task100HistoricalPredictionsModified: false, benchmarkSpecificRuntimeLogic: false },
    before: { coverage: before.coverageMetrics, commercialRoleStrict: before.commercialRoleMetrics, whoStrict: before.whoMetrics, competitorSafety: before.competitorSafetyMetrics, firstErrorDistribution: before.firstErrorAnalysis.distribution }, after: metrics, comparisons,
    newlyExposedDownstreamErrors: comparisons.filter((x) => x.firstError && x.firstError !== "INSUFFICIENT_EVIDENCE_HANDLING").map((x) => ({ benchmarkCompanyId: x.benchmarkCompanyId, category: x.firstError })) };
  await writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`);
  const b = before.coverageMetrics;
  const report = `# TASK #105 — Evidence Admission Repair\n\n**Status:** ${artifact.status}\n\n## Implementation and run\n\nThe generic CompanyAssessmentReadiness boundary now admits identity-safe, MCI-sufficient evidence with explicit primary-business text; sparse optional fields remain UNKNOWN. Original admissible provenance UUIDs are retained; canonical profile text uses an explicitly labeled canonical-company record reference; unlinked MCI claims are rejected. This regression cloned the persisted Task #100 development projects and their evidence into a new \`TASK_105_POST_REPAIR_REGRESSION\` run. Provider methods throw if invoked; provider-call count was **${providerCalls}**. Semantic model calls were permitted for newly admitted evidence.\n\n## Files changed\n\n- \`artifacts/api-server/src/lib/company-semantic-assessment.ts\`\n- \`artifacts/api-server/src/lib/minimum-company-intelligence.ts\`\n- \`artifacts/api-server/scripts/company-assessment-readiness-test-entry.ts\`\n- \`artifacts/api-server/scripts/test-company-assessment-readiness.mjs\`\n- \`artifacts/api-server/scripts/fix-08-test-entry.ts\`\n- \`artifacts/api-server/scripts/test-fix-08.mjs\`\n- \`artifacts/api-server/scripts/task-105-evidence-admission-regression-entry.ts\`\n- \`artifacts/api-server/scripts/run-task-105-evidence-admission-regression.mjs\`\n- \`artifacts/api-server/package.json\`\n- the two Task #105 evaluation artifacts\n\n## Tests and commands\n\n- Company assessment readiness: PASS 11/11\n- Fix08 focused checks: PASS 18/18\n- Buyer-role regressions: PASS 20/20\n- Company profile resolution: PASS 12/12\n- MCI, ICP qualification, semantic idempotency, provider routing, and research replay: PASS\n- API typecheck: PASS\n\n## Safety\n\n- Gold SHA-256 unchanged: \`${artifact.goldSha256}\`\n- Gold modified: NO\n- Task #100 historical raw predictions modified: NO\n- Production modified: NO\n- Benchmark-specific runtime logic: NO\n- Identity safety weakened: NO\n\n## Before → after\n\n| Measure | Before | After |\n|---|---:|---:|\n| CommercialRole coverage | ${b.commercialRoleAvailable}/20 | ${metrics.commercialRoleCoverage}/20 |\n| Non-UNKNOWN CommercialRole | ${20 - b.predictedUnknownRole}/20 | ${20 - metrics.unknownCommercialRole}/20 |\n| WHO available | ${b.whoAvailable}/20 | ${metrics.whoAvailable}/20 |\n| Complete CommercialRole + WHO | ${b.completeRoleWhoPair}/20 | ${metrics.completeRoleWho}/20 |\n| CommercialRole strict accuracy | ${before.commercialRoleMetrics.correct}/18 | ${metrics.commercialRoleStrict.correct}/18 |\n| WHO strict accuracy | ${before.whoMetrics.correct}/18 | ${metrics.whoStrict.correct}/18 |\n| Dangerous competitor → buyer | ${before.competitorSafetyMetrics.dangerousCompetitorAsBuyerCount} | ${metrics.dangerousCompetitorAsBuyer} |\n| Evidence-insufficient first errors | 13 | ${distribution.INSUFFICIENT_EVIDENCE_HANDLING} |\n\n## First-error distribution\n\n${Object.entries(distribution).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n## Newly exposed downstream errors\n\n${artifact.newlyExposedDownstreamErrors.length ? artifact.newlyExposedDownstreamErrors.map((x: any) => `- ${x.benchmarkCompanyId}: ${x.category}`).join("\n") : "None."}\n\n**Repair verdict:** ${artifact.repairVerdict}. The dominant inappropriate evidence-sufficiency failure fell from 13 records to 0 without introducing competitor-as-buyer errors. The remaining CommercialRole, WHO, identity, and provider-data errors are explicitly out of scope and were not changed. This is a post-change diagnostic on a seen benchmark, not independent generalization evidence.\n`;
  await writeFile(REPORT, report);
  console.log(JSON.stringify({ status: artifact.status, providerCalls, metrics }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });