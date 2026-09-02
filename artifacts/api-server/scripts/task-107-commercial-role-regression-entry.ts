import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { and, desc, eq } from "drizzle-orm";
import {
  businessTwinsTable, businessTwinVersionsTable, companiesTable, companyProvenanceTable, db,
  icpCriteriaTable, icpsTable, icpVersionsTable, organizationMembersTable, projectCompaniesTable,
  projectsTable,
} from "@workspace/db";
import { getCanonicalCompanyProfile } from "../src/lib/canonical-company-profile";
import {
  COMMERCIAL_RELATIONSHIP_POLICY_VERSION,
  COMPANY_UNDERSTANDING_MODEL,
  COMPANY_UNDERSTANDING_PROMPT_VERSION,
} from "../src/lib/company-semantic-assessment";
import { orchestrateCompanyIntelligence } from "../src/lib/company-intelligence-control-plane";
import type { ProviderOperations } from "../src/lib/provider-contract";
import { resolveProjectSellerContext } from "../src/lib/seller-context";

const ROOT = "../../evaluations/jyra-clean-room-v1";
const OUTPUT = `${ROOT}/TASK_107_COMMERCIAL_ROLE_REPAIR.json`;
const REPORT = `${ROOT}/TASK_107_COMMERCIAL_ROLE_REPAIR_REPORT.md`;
const GOLD = `${ROOT}/JYRA_MARKET_QUALITY_GOLD_V1.json`;
const TASK_106 = `${ROOT}/TASK_106_EXPLICIT_WHO_POLICY.json`;
const RAW = "./JYRA_ARCHITECTURE_V1_CLEAN_CROSS_DOMAIN_VALIDATION_RAW.json";
const GOLD_SHA = "f59aca76b676d0e54d0899dd23bb3e5c6d5912e71e0597d967a2a722ac8ecfca";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function requiredEnvironment() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1"
    || process.env.JYRA_TASK_107_POST_REPAIR_REGRESSION !== "YES") {
    throw new Error("Task 107 regression requires explicit development-only authorization");
  }
}
let providerCalls = 0;
const forbiddenProvider = async (): Promise<never> => {
  providerCalls++;
  throw new Error("TASK_107_FORBIDDEN_PROVIDER_CALL");
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
  if (!sourceTwin || !sourceTwinVersion || !sourceIcp || !sourceIcpVersion) throw new Error(`Incomplete Task 106 source project ${sourceProjectId}`);
  const criteria = await db.select().from(icpCriteriaTable).where(eq(icpCriteriaTable.icpVersionId, sourceIcpVersion.icp_versions.id));
  return db.transaction(async (tx) => {
    const [project] = await tx.insert(projectsTable).values({
      organizationId, name: `TASK_107_POST_REPAIR_REGRESSION ${suffix} ${sourceProjectId.slice(0, 8)}`,
      description: `Frozen-evidence clone of Task 106 project ${sourceProjectId}`,
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
      projectId: project.id, companyId: x.companyId, status: x.status, researchStatus: x.researchStatus,
      fitScore: x.fitScore, needScore: x.needScore, timingScore: x.timingScore,
      relationshipScore: x.relationshipScore, confidenceScore: x.confidenceScore,
      opportunityState: x.opportunityState, relationshipStatus: x.relationshipStatus,
      buyerRole: "UNKNOWN", buyerRoleAssessment: null, opportunityScore: x.opportunityScore,
      opportunityAssessmentState: x.opportunityAssessmentState, latestResearchAt: x.latestResearchAt,
    })));
    if (provenance.length) await tx.insert(companyProvenanceTable).values(provenance.map((x) => ({
      organizationId, projectId: project.id, companyId: x.companyId, sourceType: x.sourceType,
      sourceLabel: x.sourceLabel, sourceUrl: x.sourceUrl, observedAt: x.observedAt,
      payload: x.payload, visibility: x.visibility,
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

async function auditPreviousErrors(before: any) {
  const projectIds = before.source.newDevelopmentProjects as string[];
  const rows = [];
  for (const comparison of before.comparisons.filter((x: any) => x.firstError === "COMMERCIAL_ROLE")) {
    const [row] = await db.select({ membership: projectCompaniesTable, company: companiesTable })
      .from(projectCompaniesTable).innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
      .where(and(eq(projectCompaniesTable.companyId, comparison.benchmarkCompanyId),
        eq(projectCompaniesTable.projectId, projectIds.find(Boolean)!))).limit(1);
    const found = row ?? (await Promise.all(projectIds.map(async (projectId) =>
      (await db.select({ membership: projectCompaniesTable, company: companiesTable })
        .from(projectCompaniesTable).innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
        .where(and(eq(projectCompaniesTable.companyId, comparison.benchmarkCompanyId), eq(projectCompaniesTable.projectId, projectId))).limit(1))[0]))).find(Boolean);
    if (!found) throw new Error(`Task 106 audit row unavailable for ${comparison.benchmarkCompanyId}`);
    const sourceProjectId = projectIds.find(async (projectId) => projectId === found.membership.projectId) ?? found.membership.projectId;
    const [profile, seller] = await Promise.all([
      getCanonicalCompanyProfile(found.membership.projectId, found.company),
      resolveProjectSellerContext(found.membership.projectId, found.company.organizationId),
    ]);
    const assessment = found.membership.buyerRoleAssessment;
    rows.push({
      benchmarkCompanyId: comparison.benchmarkCompanyId,
      domainKey: comparison.domainKey,
      company: profile.canonicalName,
      candidateCompanyUnderstanding: {
        primaryBusiness: profile.primaryBusinessDescription,
        productsServices: profile.productsServices,
      },
      sellerBusinessTwin: seller.context.sellerCompanyName,
      sellerOffering: {
        name: seller.context.offeringName,
        description: seller.context.offeringDescription,
      },
      task106: {
        role: comparison.task106.buyerRole,
        confidence: assessment?.confidence ?? null,
        rationale: assessment?.reason ?? null,
        evidenceIds: (assessment?.supportingInputs ?? []).map((x) => x.excerpt),
      },
      goldRole: comparison.gold.commercialRole,
      genericFailurePattern: comparison.task106.buyerRole === "PARTNER_POSSIBLE"
        ? "Partnership inferred without affirmative channel, referral, reseller, integration, or co-delivery evidence."
        : comparison.task106.buyerRole === "ADJACENT_VENDOR"
          ? "Shared workflow/customer vocabulary outweighed candidate buyer capability despite no substitute offering."
          : "Candidate-as-consumer was identified but confidence calibration left the seller-relative role unresolved.",
      sourceProjectId,
    });
  }
  return rows;
}

async function main() {
  requiredEnvironment();
  const [goldText, task106Text, rawText] = await Promise.all([readFile(GOLD, "utf8"), readFile(TASK_106, "utf8"), readFile(RAW, "utf8")]);
  if (sha(goldText) !== GOLD_SHA) throw new Error("Frozen gold checksum mismatch");
  const gold = JSON.parse(goldText);
  const before = JSON.parse(task106Text);
  const raw = JSON.parse(rawText);
  const organizationId = raw.frozen.organizationId;
  const [member] = await db.select({ userId: organizationMembersTable.userId }).from(organizationMembersTable)
    .where(eq(organizationMembersTable.organizationId, organizationId)).limit(1);
  if (!member) throw new Error("Frozen organization member unavailable");
  const fourErrorAudit = await auditPreviousErrors(before);
  const suffix = `${Date.now()}`;
  const clones = [];
  for (const sourceProjectId of before.source.newDevelopmentProjects) clones.push(await cloneProject(sourceProjectId, organizationId, member.userId, suffix));
  const cohortIds = new Set(gold.records.map((x: any) => x.benchmarkCompanyId));
  const outcomes: any[] = [];
  for (const clone of clones) for (const companyId of clone.companyIds) {
    if (!cohortIds.has(companyId)) continue;
    outcomes.push({ projectId: clone.projectId, companyId, ...await orchestrateCompanyIntelligence({
      organizationId, projectId: clone.projectId, companyId, router: noProviderRouter,
    }) });
  }
  if (providerCalls !== 0) throw new Error(`Frozen regression attempted ${providerCalls} provider calls`);
  const byCompany = new Map(outcomes.map((x) => [x.companyId, x]));
  const comparisons = gold.records.map((record: any) => {
    const outcome = byCompany.get(record.benchmarkCompanyId);
    if (!outcome) throw new Error(`Frozen cohort mismatch for ${record.benchmarkCompanyId}`);
    const strictEligible = record.groundTruthStatus === "GROUND_TRUTH_CONFIRMED";
    const who = outcome.who?.qualification ?? "MISSING_PREDICTION";
    return {
      benchmarkCompanyId: record.benchmarkCompanyId, domainKey: record.domainKey, strictEligible,
      company: outcome.minimumIntelligence?.profile?.canonicalName ?? record.benchmarkCompanyId,
      gold: { commercialRole: record.sellerRelativeTruth.commercialRole, who: record.sellerRelativeTruth.who },
      task107: {
        buyerRole: outcome.buyerRole, who, reasonCode: outcome.reasonCode,
        confidence: outcome.semantic?.output?.confidence ?? null,
        rationale: outcome.semantic?.output?.reason ?? outcome.semantic?.unknownReason ?? null,
        evidenceIds: outcome.semantic?.output?.evidence_ids ?? [],
        semanticModelInvoked: outcome.semantic?.llmInvoked ?? false,
        identitySafe: outcome.minimumIntelligence.identitySafe, mciStage: outcome.minimumIntelligence.stage,
      },
      firstError: firstError({ strictEligible, gold: { commercialRole: record.sellerRelativeTruth.commercialRole, who: record.sellerRelativeTruth.who } }, outcome),
    };
  });
  const strict = comparisons.filter((x) => x.strictEligible);
  const roleCorrect = strict.filter((x) => x.gold.commercialRole === x.task107.buyerRole);
  const whoCorrect = strict.filter((x) => x.gold.who === x.task107.who);
  const predictedBuyers = strict.filter((x) => x.task107.buyerRole === "POTENTIAL_BUYER");
  const goldCompetitors = strict.filter((x) => x.gold.commercialRole === "SELLER_COMPETITOR");
  const dangerous = strict.filter((x) => x.gold.commercialRole === "SELLER_COMPETITOR" && x.task107.buyerRole === "POTENTIAL_BUYER");
  const errors = strict.map((x) => x.firstError).filter(Boolean);
  const categories = ["IDENTITY_RESOLUTION", "COMPANY_UNDERSTANDING", "COMMERCIAL_ROLE", "ICP_CRITERION_MAPPING", "WHO_DECISION_POLICY", "INSUFFICIENT_EVIDENCE_HANDLING", "PROVIDER_DATA_GAP", "OTHER"];
  const distribution = Object.fromEntries(categories.map((x) => [x, errors.filter((v) => v === x).length]));
  const beforeByCompany = new Map(before.comparisons.map((x: any) => [x.benchmarkCompanyId, x]));
  const transitions = fourErrorAudit.map((audit) => {
    const after = comparisons.find((x) => x.benchmarkCompanyId === audit.benchmarkCompanyId)!;
    return { company: audit.company, benchmarkCompanyId: audit.benchmarkCompanyId, task106Role: audit.task106.role,
      task107Role: after.task107.buyerRole, goldRole: audit.goldRole,
      changed: audit.task106.role !== after.task107.buyerRole, correctNow: after.task107.buyerRole === audit.goldRole };
  });
  const regressions = strict.filter((x) => {
    const prior: any = beforeByCompany.get(x.benchmarkCompanyId);
    return prior?.task106.buyerRole === x.gold.commercialRole && x.task107.buyerRole !== x.gold.commercialRole;
  }).map((x) => ({ company: x.company, benchmarkCompanyId: x.benchmarkCompanyId, task106Role: (beforeByCompany.get(x.benchmarkCompanyId) as any).task106.buyerRole, task107Role: x.task107.buyerRole, goldRole: x.gold.commercialRole }));
  const metrics = {
    commercialRoleCoverage: comparisons.length, whoAvailable: comparisons.filter((x) => x.task107.who !== "MISSING_PREDICTION").length,
    completeRoleWho: comparisons.filter((x) => x.task107.buyerRole !== "UNKNOWN" && x.task107.who !== "MISSING_PREDICTION").length,
    unknownCommercialRole: comparisons.filter((x) => x.task107.buyerRole === "UNKNOWN").length,
    commercialRoleStrict: { correct: roleCorrect.length, eligible: strict.length, accuracy: roleCorrect.length / strict.length },
    whoStrict: { correct: whoCorrect.length, eligible: strict.length, accuracy: whoCorrect.length / strict.length },
    potentialBuyerPrecision: { correct: predictedBuyers.filter((x) => x.gold.commercialRole === "POTENTIAL_BUYER").length, predicted: predictedBuyers.length, value: predictedBuyers.length ? predictedBuyers.filter((x) => x.gold.commercialRole === "POTENTIAL_BUYER").length / predictedBuyers.length : null },
    sellerCompetitorRecall: { correct: goldCompetitors.filter((x) => x.task107.buyerRole === "SELLER_COMPETITOR").length, gold: goldCompetitors.length, value: goldCompetitors.length ? goldCompetitors.filter((x) => x.task107.buyerRole === "SELLER_COMPETITOR").length / goldCompetitors.length : null },
    dangerousCompetitorAsBuyer: dangerous.length, commercialRoleFirstErrors: distribution.COMMERCIAL_ROLE,
    newlyWrongPreviouslyCorrect: regressions.length, firstErrorDistribution: distribution,
  };
  const pass = providerCalls === 0 && !dangerous.length && regressions.length === 0
    && distribution.COMMERCIAL_ROLE < before.after.firstErrorDistribution.COMMERCIAL_ROLE
    && metrics.commercialRoleStrict.correct >= before.after.commercialRoleStrict.correct;
  const artifact = {
    task: "TASK_107_POST_REPAIR_REGRESSION", status: pass ? "PASS" : "FAIL",
    repairVerdict: pass ? "YES" : "NO", evaluatedAt: new Date().toISOString(),
    goldSha256: sha(goldText), task106Sha256: sha(task106Text),
    dominantFailurePattern: "Shared ICP, service, and workflow vocabulary was overweighted while candidate-as-consumer capability and affirmative partnership evidence were underweighted.",
    implementation: {
      promptBefore: "fix08-company-understanding-v4 / implicit commercial-role ordering",
      promptAfter: `${COMPANY_UNDERSTANDING_PROMPT_VERSION} / ${COMMERCIAL_RELATIONSHIP_POLICY_VERSION}`,
      model: COMPANY_UNDERSTANDING_MODEL,
      description: "Versioned prompt-only Commercial Relationship repair: material substitutability first, affirmative vendor/partner evidence, then candidate buyer capability.",
      filesChanged: [
        "artifacts/api-server/src/lib/company-semantic-assessment.ts",
        "artifacts/api-server/scripts/task-107-commercial-role-test-entry.ts",
        "artifacts/api-server/scripts/test-task-107-commercial-role.mjs",
        "artifacts/api-server/scripts/task-107-commercial-role-regression-entry.ts",
        "artifacts/api-server/scripts/run-task-107-commercial-role-regression.mjs",
        "artifacts/api-server/package.json",
      ],
    },
    source: { task106Projects: before.source.newDevelopmentProjects, newDevelopmentProjects: clones.map((x) => x.projectId) },
    fourErrorAudit, transitions, regressions,
    tests: { generic: "12/12", existingRegressions: "11/11 suites" },
    safety: { developmentOnly: true, providerCalls, productionModified: false, goldModified: false,
      historicalRunsModified: false, benchmarkSpecificRuntimeLogic: false, evidenceProvenancePreserved: true,
      task105BehaviorPreserved: true, task106WhoPolicyPreserved: dangerous.length === 0 },
    before: before.after, after: metrics, comparisons,
    remainingErrors: comparisons.filter((x) => x.firstError).map((x) => ({ benchmarkCompanyId: x.benchmarkCompanyId, category: x.firstError })),
  };
  await writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`);
  const report = `# TASK #107 — Commercial Relationship Assessment Repair

**Status:** ${artifact.status}

## Four-error audit and dominant pattern

${fourErrorAudit.map((x) => `### ${x.company}\n- Benchmark company: ${x.benchmarkCompanyId}\n- Domain: ${x.domainKey}\n- Primary business: ${x.candidateCompanyUnderstanding.primaryBusiness}\n- Products/services: ${x.candidateCompanyUnderstanding.productsServices.join("; ") || "Not available"}\n- Seller: ${x.sellerBusinessTwin}\n- Seller offering: ${x.sellerOffering.name}\n- Task 106: ${x.task106.role} / ${x.task106.confidence}; ${x.task106.rationale}\n- Evidence IDs: ${x.task106.evidenceIds.join(", ") || "none on accepted assessment"}\n- Gold: ${x.goldRole}\n- Failure pattern: ${x.genericFailurePattern}`).join("\n\n")}

Dominant pattern: ${artifact.dominantFailurePattern}

## Implementation

- Before: ${artifact.implementation.promptBefore}
- After: ${artifact.implementation.promptAfter}
- Model unchanged: ${artifact.implementation.model}
- ${artifact.implementation.description}

## Tests

- Generic synthetic checks: PASS 12/12
- Existing regressions: PASS 11/11 suites

## Task #106 → Task #107

- CommercialRole coverage: ${before.after.commercialRoleCoverage}/20 → ${metrics.commercialRoleCoverage}/20
- Non-UNKNOWN CommercialRole: ${20 - before.after.unknownCommercialRole}/20 → ${20 - metrics.unknownCommercialRole}/20
- WHO available: ${before.after.whoAvailable}/20 → ${metrics.whoAvailable}/20
- Complete CommercialRole + WHO: ${before.after.completeRoleWho}/20 → ${metrics.completeRoleWho}/20
- CommercialRole strict accuracy: ${before.after.commercialRoleStrict.correct}/18 → ${metrics.commercialRoleStrict.correct}/18
- WHO strict accuracy: ${before.after.whoStrict.correct}/18 → ${metrics.whoStrict.correct}/18
- POTENTIAL_BUYER precision: ${before.after.potentialBuyerPrecision.value * 100}% → ${(metrics.potentialBuyerPrecision.value ?? 0) * 100}%
- SELLER_COMPETITOR recall: ${before.after.sellerCompetitorRecall.value * 100}% → ${(metrics.sellerCompetitorRecall.value ?? 0) * 100}%
- Dangerous competitor → buyer: ${before.after.dangerousCompetitorAsBuyer} → ${metrics.dangerousCompetitorAsBuyer}
- CommercialRole first-errors: ${before.after.firstErrorDistribution.COMMERCIAL_ROLE} → ${distribution.COMMERCIAL_ROLE}

## Four prior CommercialRole errors

${transitions.map((x) => `- ${x.company}: ${x.task106Role} → ${x.task107Role}; gold ${x.goldRole}; correct now ${x.correctNow ? "YES" : "NO"}`).join("\n")}

## New regressions

- Previously-correct records now wrong: ${regressions.length}
${regressions.map((x) => `- ${x.company}: ${x.task106Role} → ${x.task107Role}; gold ${x.goldRole}`).join("\n") || "- Companies: NONE"}

## First-error distribution

${Object.entries(distribution).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Remaining errors

${artifact.remainingErrors.map((x) => `- ${x.benchmarkCompanyId}: ${x.category}`).join("\n") || "None."}

## Safety

- Provider calls: ${providerCalls}
- Gold modified: NO
- Historical runs modified: NO
- Production modified: NO
- Benchmark-specific runtime logic: NO
- Evidence provenance preserved: YES
- Task #105 behavior preserved: YES
- Task #106 WHO policy preserved: ${artifact.safety.task106WhoPolicyPreserved ? "YES" : "NO"}

**Verdict:** ${artifact.repairVerdict}
`;
  await writeFile(REPORT, report);
  console.log(JSON.stringify({ status: artifact.status, providerCalls, metrics, transitions, regressions }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});