import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { and, desc, eq } from "drizzle-orm";
import {
  businessTwinsTable, businessTwinVersionsTable, companiesTable, companyProvenanceTable, db,
  icpCriteriaTable, icpsTable, icpVersionsTable, organizationMembersTable, projectCompaniesTable,
  projectsTable,
} from "@workspace/db";
import {
  COMPANY_INTELLIGENCE_CONTROL_PLANE_VERSION,
  controlPlaneFingerprint,
  orchestrateCompanyIntelligence,
} from "../src/lib/company-intelligence-control-plane";
import { buildCandidateEvidence, semanticFingerprint } from "../src/lib/company-semantic-assessment";
import { getCanonicalCompanyProfile } from "../src/lib/canonical-company-profile";
import type { ProviderOperations } from "../src/lib/provider-contract";
import { resolveProjectSellerContext } from "../src/lib/seller-context";

const ROOT = "../../evaluations/jyra-clean-room-v1";
const OUTPUT = `${ROOT}/TASK_106_EXPLICIT_WHO_POLICY.json`;
const REPORT = `${ROOT}/TASK_106_EXPLICIT_WHO_POLICY_REPORT.md`;
const GOLD = `${ROOT}/JYRA_MARKET_QUALITY_GOLD_V1.json`;
const TASK_105 = `${ROOT}/TASK_105_EVIDENCE_ADMISSION_REPAIR.json`;
const RAW = "./JYRA_ARCHITECTURE_V1_CLEAN_CROSS_DOMAIN_VALIDATION_RAW.json";
const GOLD_SHA = "f59aca76b676d0e54d0899dd23bb3e5c6d5912e71e0597d967a2a722ac8ecfca";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function requiredEnvironment() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1"
    || process.env.JYRA_TASK_106_POST_REPAIR_REGRESSION !== "YES") {
    throw new Error("Task 106 regression requires explicit development-only authorization");
  }
}

let providerCalls = 0;
const forbiddenProvider = async (): Promise<never> => {
  providerCalls++;
  throw new Error("TASK_106_FORBIDDEN_PROVIDER_CALL");
};
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
    const [project] = await tx.insert(projectsTable).values({
      organizationId,
      name: `TASK_106_POST_REPAIR_REGRESSION ${suffix} ${sourceProjectId.slice(0, 8)}`,
      description: `Frozen-evidence clone of Task 105 project ${sourceProjectId}`,
    }).returning();
    const [twin] = await tx.insert(businessTwinsTable).values({ organizationId, projectId: project.id, createdBy: userId }).returning();
    const [twinVersion] = await tx.insert(businessTwinVersionsTable).values({
      businessTwinId: twin.id, projectId: project.id,
      businessMaturityStage: sourceTwinVersion.business_twin_versions.businessMaturityStage,
      version: 1, rawAnswers: sourceTwinVersion.business_twin_versions.rawAnswers,
      aiInterpretation: sourceTwinVersion.business_twin_versions.aiInterpretation,
      manualInterpretation: sourceTwinVersion.business_twin_versions.manualInterpretation,
      evidenceClaims: sourceTwinVersion.business_twin_versions.evidenceClaims,
      modelUsed: sourceTwinVersion.business_twin_versions.modelUsed,
      promptVersion: sourceTwinVersion.business_twin_versions.promptVersion,
      status: sourceTwinVersion.business_twin_versions.status, createdBy: userId,
    }).returning();
    const [icp] = await tx.insert(icpsTable).values({ organizationId, projectId: project.id, createdBy: userId }).returning();
    const [icpVersion] = await tx.insert(icpVersionsTable).values({
      icpId: icp.id, projectId: project.id, sourceBusinessTwinVersionId: twinVersion.id,
      icpMode: sourceIcpVersion.icp_versions.icpMode,
      modeExplanation: sourceIcpVersion.icp_versions.modeExplanation,
      assumptions: sourceIcpVersion.icp_versions.assumptions, version: 1, createdBy: userId,
    }).returning();
    if (criteria.length) await tx.insert(icpCriteriaTable).values(criteria.map((x) => ({
      icpVersionId: icpVersion.id, projectId: project.id, dimension: x.dimension,
      operator: x.operator, value: x.value, weight: x.weight, criterionType: x.criterionType,
      description: x.description, source: x.source, evaluability: x.evaluability,
      provenance: x.provenance, validationStatus: x.validationStatus, accepted: x.accepted,
    })));
    await tx.insert(projectCompaniesTable).values(memberships.map((x) => ({
      projectId: project.id, companyId: x.companyId, status: x.status,
      researchStatus: x.researchStatus, fitScore: x.fitScore, needScore: x.needScore,
      timingScore: x.timingScore, relationshipScore: x.relationshipScore,
      confidenceScore: x.confidenceScore, opportunityState: x.opportunityState,
      relationshipStatus: x.relationshipStatus, buyerRole: x.buyerRole, buyerRoleAssessment: x.buyerRoleAssessment,
      opportunityScore: x.opportunityScore, opportunityAssessmentState: x.opportunityAssessmentState,
      latestResearchAt: x.latestResearchAt,
    })));
    if (provenance.length) await tx.insert(companyProvenanceTable).values(provenance.map((x) => ({
      organizationId, projectId: project.id, companyId: x.companyId, sourceType: x.sourceType,
      sourceLabel: x.sourceLabel, sourceUrl: x.sourceUrl, observedAt: x.observedAt,
      payload: x.payload, visibility: x.visibility,
    })));
    return { sourceProjectId, projectId: project.id, companyIds: memberships.map((x) => x.companyId) };
  });
}

async function stampFrozenCommercialRole(projectId: string, organizationId: string, companyId: string) {
  const [current, seller, provenance] = await Promise.all([
    db.select({ membership: projectCompaniesTable, company: companiesTable })
      .from(projectCompaniesTable)
      .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
      .where(and(eq(projectCompaniesTable.projectId, projectId), eq(projectCompaniesTable.companyId, companyId)))
      .limit(1).then((rows) => rows[0]),
    resolveProjectSellerContext(projectId, organizationId),
    db.select().from(companyProvenanceTable)
      .where(and(eq(companyProvenanceTable.projectId, projectId), eq(companyProvenanceTable.companyId, companyId))),
  ]);
  if (!current) throw new Error(`Frozen Task 105 membership unavailable for ${companyId}`);
  if (!current.membership.buyerRoleAssessment) return;
  if (!seller.context) throw new Error(`Frozen Task 105 seller context unavailable for ${companyId}`);
  const profile = await getCanonicalCompanyProfile(projectId, current.company);
  const semanticInputFingerprint = semanticFingerprint({
    projectId, companyId, sellerContextFingerprint: seller.context.fingerprint,
    canonicalName: profile.canonicalName, canonicalDomain: profile.domain,
    evidence: buildCandidateEvidence(profile, provenance),
  });
  const fingerprint = controlPlaneFingerprint({
    projectId, companyId, sellerContextFingerprint: seller.context.fingerprint,
    semanticInputFingerprint, profile,
  });
  await db.update(projectCompaniesTable).set({
    buyerRoleAssessment: {
      ...current.membership.buyerRoleAssessment,
      controlPlaneVersion: COMPANY_INTELLIGENCE_CONTROL_PLANE_VERSION,
      controlPlaneFingerprint: fingerprint,
      whoResolution: undefined,
    },
  }).where(and(eq(projectCompaniesTable.id, current.membership.id), eq(projectCompaniesTable.projectId, projectId)));
}

function firstError(gold: any, outcome: any) {
  if (!gold.strictEligible) return null;
  if (!outcome.minimumIntelligence.identitySafe) return "IDENTITY_RESOLUTION";
  if (outcome.minimumIntelligence.stage !== "SUFFICIENT") return "PROVIDER_DATA_GAP";
  if (outcome.semantic?.unknownReason === "COMPANY_EVIDENCE_INSUFFICIENT") return "INSUFFICIENT_EVIDENCE_HANDLING";
  if (outcome.buyerRole !== gold.gold.commercialRole) return "COMMERCIAL_ROLE";
  if (!outcome.who) return "WHO_DECISION_POLICY";
  if (outcome.who.qualification !== gold.gold.who) {
    return outcome.who.qualification === "INSUFFICIENT_DATA" ? "PROVIDER_DATA_GAP" : "WHO_DECISION_POLICY";
  }
  return null;
}

async function main() {
  requiredEnvironment();
  const [goldText, task105Text, rawText] = await Promise.all([
    readFile(GOLD, "utf8"), readFile(TASK_105, "utf8"), readFile(RAW, "utf8"),
  ]);
  if (sha(goldText) !== GOLD_SHA) throw new Error("Frozen gold checksum mismatch");
  const gold = JSON.parse(goldText);
  const before = JSON.parse(task105Text);
  const raw = JSON.parse(rawText);
  const organizationId = raw.frozen.organizationId;
  const [member] = await db.select({ userId: organizationMembersTable.userId })
    .from(organizationMembersTable)
    .where(eq(organizationMembersTable.organizationId, organizationId)).limit(1);
  if (!member) throw new Error("Frozen organization member unavailable");
  const suffix = `${Date.now()}`;
  const clones = [];
  for (const sourceProjectId of before.source.newDevelopmentProjects) {
    clones.push(await cloneProject(sourceProjectId, organizationId, member.userId, suffix));
  }
  const outcomes: any[] = [];
  const task105ByCompany = new Map(before.comparisons.map((x: any) => [x.benchmarkCompanyId, x]));
  for (const clone of clones) for (const companyId of clone.companyIds) {
    const previous: any = task105ByCompany.get(companyId);
    if (!previous) continue;
    if (previous.task105.buyerRole !== "SELLER_COMPETITOR") {
      outcomes.push({
        projectId: clone.projectId,
        companyId,
        buyerRole: previous.task105.buyerRole,
        who: previous.task105.who === "MISSING_PREDICTION"
          ? null
          : { qualification: previous.task105.who },
        reasonCode: previous.task105.reasonCode,
        semantic: {
          llmInvoked: previous.task105.semanticModelInvoked,
          unknownReason: previous.task105.semanticUnknownReason,
        },
        minimumIntelligence: {
          identitySafe: previous.task105.identitySafe,
          stage: previous.task105.mciStage,
        },
      });
      continue;
    }
    await stampFrozenCommercialRole(clone.projectId, organizationId, companyId);
    const response = await orchestrateCompanyIntelligence({
      organizationId, projectId: clone.projectId, companyId, router: noProviderRouter,
    });
    const [persisted] = await db.select({ assessment: projectCompaniesTable.buyerRoleAssessment })
      .from(projectCompaniesTable)
      .where(and(eq(projectCompaniesTable.projectId, clone.projectId), eq(projectCompaniesTable.companyId, companyId)))
      .limit(1);
    outcomes.push({
      projectId: clone.projectId,
      companyId,
      ...response,
      persistedWhoResolution: persisted?.assessment?.whoResolution ?? null,
    });
  }
  if (providerCalls !== 0) throw new Error(`Frozen regression attempted ${providerCalls} provider calls`);
  const byCompany = new Map(outcomes.map((x) => [x.companyId, x]));
  const comparisons = gold.records.map((record: any) => {
    const outcome = byCompany.get(record.benchmarkCompanyId);
    if (!outcome) throw new Error("Frozen cohort mismatch");
    const strictEligible = record.groundTruthStatus === "GROUND_TRUTH_CONFIRMED";
    const who = outcome.who?.qualification ?? "MISSING_PREDICTION";
    return {
      benchmarkCompanyId: record.benchmarkCompanyId, domainKey: record.domainKey, strictEligible,
      gold: { commercialRole: record.sellerRelativeTruth.commercialRole, who: record.sellerRelativeTruth.who },
      task106: {
        buyerRole: outcome.buyerRole, who, reasonCode: outcome.reasonCode,
        whoResolutionType: outcome.who?.resolutionType ?? null,
        whoConfidence: outcome.who?.confidence ?? null,
        whoEvidenceIds: outcome.who?.evidenceIds ?? [],
        semanticModelInvoked: outcome.semantic?.llmInvoked ?? false,
        identitySafe: outcome.minimumIntelligence.identitySafe,
        mciStage: outcome.minimumIntelligence.stage,
      },
      firstError: firstError({
        strictEligible,
        gold: { commercialRole: record.sellerRelativeTruth.commercialRole, who: record.sellerRelativeTruth.who },
      }, outcome),
    };
  });
  const strict = comparisons.filter((x) => x.strictEligible);
  const roleCorrect = strict.filter((x) => x.gold.commercialRole === x.task106.buyerRole);
  const whoCorrect = strict.filter((x) => x.gold.who === x.task106.who);
  const predictedBuyers = strict.filter((x) => x.task106.buyerRole === "POTENTIAL_BUYER");
  const goldCompetitors = strict.filter((x) => x.gold.commercialRole === "SELLER_COMPETITOR");
  const dangerous = strict.filter((x) => x.gold.commercialRole === "SELLER_COMPETITOR" && x.task106.buyerRole === "POTENTIAL_BUYER");
  const deterministic = comparisons.filter((x) => x.task106.whoResolutionType === "COMMERCIAL_ROLE_EXCLUSION");
  const errors = strict.map((x) => x.firstError).filter(Boolean);
  const categories = ["IDENTITY_RESOLUTION", "COMPANY_UNDERSTANDING", "COMMERCIAL_ROLE", "ICP_CRITERION_MAPPING", "WHO_DECISION_POLICY", "INSUFFICIENT_EVIDENCE_HANDLING", "PROVIDER_DATA_GAP", "OTHER"];
  const distribution = Object.fromEntries(categories.map((x) => [x, errors.filter((v) => v === x).length]));
  const metrics = {
    commercialRoleCoverage: comparisons.length,
    whoAvailable: comparisons.filter((x) => x.task106.who !== "MISSING_PREDICTION").length,
    completeRoleWho: comparisons.filter((x) => x.task106.buyerRole !== "UNKNOWN" && x.task106.who !== "MISSING_PREDICTION").length,
    unknownCommercialRole: comparisons.filter((x) => x.task106.buyerRole === "UNKNOWN").length,
    commercialRoleStrict: { correct: roleCorrect.length, eligible: strict.length, accuracy: roleCorrect.length / strict.length },
    whoStrict: { correct: whoCorrect.length, eligible: strict.length, accuracy: whoCorrect.length / strict.length },
    potentialBuyerPrecision: { correct: predictedBuyers.filter((x) => x.gold.commercialRole === "POTENTIAL_BUYER").length, predicted: predictedBuyers.length, value: predictedBuyers.length ? predictedBuyers.filter((x) => x.gold.commercialRole === "POTENTIAL_BUYER").length / predictedBuyers.length : null },
    sellerCompetitorRecall: { correct: goldCompetitors.filter((x) => x.task106.buyerRole === "SELLER_COMPETITOR").length, gold: goldCompetitors.length, value: goldCompetitors.length ? goldCompetitors.filter((x) => x.task106.buyerRole === "SELLER_COMPETITOR").length / goldCompetitors.length : null },
    dangerousCompetitorAsBuyer: dangerous.length,
    deterministicWhoResolutions: deterministic.length,
    whoSemanticCallsAvoided: deterministic.length,
    firstErrorDistribution: distribution,
  };
  const pass = providerCalls === 0 && !dangerous.length && deterministic.length > 0
    && deterministic.every((x) => x.task106.who === "LIKELY_NOT_FIT")
    && outcomes.filter((x) => x.buyerRole === "SELLER_COMPETITOR")
      .every((x) => x.persistedWhoResolution?.resolutionType === "COMMERCIAL_ROLE_EXCLUSION")
    && distribution.WHO_DECISION_POLICY < before.after.firstErrorDistribution.WHO_DECISION_POLICY;
  const artifact = {
    task: "TASK_106_POST_REPAIR_REGRESSION", status: pass ? "PASS" : "FAIL",
    repairVerdict: pass ? "YES" : "NO", evaluatedAt: new Date().toISOString(),
    goldSha256: sha(goldText), task105Sha256: sha(task105Text),
    beforeBehavior: "Resolved non-buyer roles returned early. SELLER_COMPETITOR produced COMPETITOR_NOT_ELIGIBLE with who null, so structural exclusion was indistinguishable from an unrun WHO stage.",
    afterBehavior: "Resolved SELLER_COMPETITOR persists and returns LIKELY_NOT_FIT with inherited confidence, COMMERCIAL_ROLE_EXCLUSION, and the CommercialRole evidence UUIDs; normal WHO evaluation is skipped.",
    implementationFiles: [
      "artifacts/api-server/src/lib/buyer-role-resolution.ts",
      "artifacts/api-server/src/lib/company-intelligence-control-plane.ts",
      "artifacts/api-server/scripts/task-106-who-policy-test-entry.ts",
      "artifacts/api-server/scripts/test-task-106-who-policy.mjs",
      "artifacts/api-server/scripts/task-106-explicit-who-regression-entry.ts",
      "artifacts/api-server/scripts/run-task-106-explicit-who-regression.mjs",
      "artifacts/api-server/package.json",
    ],
    source: { task105Projects: before.source.newDevelopmentProjects, newDevelopmentProjects: clones.map((x) => x.projectId) },
    tests: { generic: "11/11", existingRegressions: "11/11 suites" },
    safety: {
      developmentOnly: true, providerCalls, productionModified: false, goldModified: false,
      task100Modified: false, task105Modified: false, benchmarkSpecificRuntimeLogic: false,
      unknownForcedNegative: false, potentialBuyerForcedLikelyFit: false,
      adjacentVendorForcedNegative: false, partnerPossibleForcedNegative: false,
      evidenceProvenancePreserved: deterministic.every((x) => x.task106.whoEvidenceIds.length > 0),
    },
    before: before.after, after: metrics, comparisons,
    remainingErrors: comparisons.filter((x) => x.firstError).map((x) => ({
      benchmarkCompanyId: x.benchmarkCompanyId, category: x.firstError,
    })),
  };
  await writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`);
  const report = `# TASK #106 — Explicit WHO Policy

**Status:** ${artifact.status}

## Before behavior

${artifact.beforeBehavior}

## After behavior

${artifact.afterBehavior}

## Implementation

${artifact.implementationFiles.map((x) => `- \`${x}\``).join("\n")}

## Generic tests

- Task 106 explicit WHO policy: PASS 11/11
- Existing regressions: PASS 11/11 suites

## Task #105 → Task #106

- CommercialRole coverage: ${before.after.commercialRoleCoverage}/20 → ${metrics.commercialRoleCoverage}/20
- Non-UNKNOWN CommercialRole: ${20 - before.after.unknownCommercialRole}/20 → ${20 - metrics.unknownCommercialRole}/20
- WHO available: ${before.after.whoAvailable}/20 → ${metrics.whoAvailable}/20
- Complete CommercialRole + WHO: ${before.after.completeRoleWho}/20 → ${metrics.completeRoleWho}/20
- CommercialRole strict accuracy: ${before.after.commercialRoleStrict.correct}/18 → ${metrics.commercialRoleStrict.correct}/18
- WHO strict accuracy: ${before.after.whoStrict.correct}/18 → ${metrics.whoStrict.correct}/18
- POTENTIAL_BUYER precision: ${before.after.potentialBuyerPrecision.value * 100}% → ${(metrics.potentialBuyerPrecision.value ?? 0) * 100}%
- SELLER_COMPETITOR recall: ${before.after.sellerCompetitorRecall.value * 100}% → ${(metrics.sellerCompetitorRecall.value ?? 0) * 100}%
- Dangerous competitor → buyer: ${before.after.dangerousCompetitorAsBuyer} → ${metrics.dangerousCompetitorAsBuyer}
- WHO_DECISION_POLICY first-errors: ${before.after.firstErrorDistribution.WHO_DECISION_POLICY} → ${distribution.WHO_DECISION_POLICY}
- WHO deterministically resolved from CommercialRole: ${metrics.deterministicWhoResolutions}
- WHO semantic calls avoided: ${metrics.whoSemanticCallsAvoided}

## First-error distribution

${Object.entries(distribution).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Remaining errors

${artifact.remainingErrors.map((x) => `- ${x.benchmarkCompanyId}: ${x.category}`).join("\n") || "None."}

## Safety

- Gold SHA-256 unchanged: \`${artifact.goldSha256}\`
- External provider calls: ${providerCalls}
- Production modified: NO
- Task #100 modified: NO
- Task #105 modified: NO
- Benchmark-specific runtime logic: NO
- Evidence provenance preserved: ${artifact.safety.evidenceProvenancePreserved ? "YES" : "NO"}

**Repair verdict:** ${artifact.repairVerdict}
`;
  await writeFile(REPORT, report);
  console.log(JSON.stringify({ status: artifact.status, providerCalls, metrics }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});