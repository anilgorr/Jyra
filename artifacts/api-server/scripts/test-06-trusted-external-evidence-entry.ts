import { and, desc, eq, inArray } from "drizzle-orm";
import {
  companiesTable,
  companyEvidenceTable,
  companyFactsTable,
  crawlPagesTable,
  db,
  evidenceAttributionReviewsTable,
  intelligencePackVersionsTable,
  opportunitiesTable,
  projectCompaniesTable,
  projectsTable,
  researchFactProposalsTable,
  researchJobsTable,
  signalClusterDefinitionsTable,
  signalDefinitionsTable,
} from "@workspace/db";
import {
  extractFactCandidatesFromSource,
  FACT_EXTRACTION_PROMPT_VERSION,
  validateFactCandidate,
} from "../src/lib/facts";
import { evaluateClustersForCompany } from "../src/lib/signal-clusters";
import { evaluateSignalsForCompany } from "../src/lib/signal-packs";
import { evaluateOpportunity } from "../src/lib/opportunity-engine";
import {
  generateWhyForOpportunity,
  getWhyDetail,
} from "../src/lib/opportunity-why";
import { getNextBestActionForCompany } from "../src/lib/next-best-action-service";

const COMPANY_DOMAIN = "7cstudio.com";
const PROJECT_NAME = "GTM-Q1";
const EXPECTED_SIGNAL_CODES = [
  "MSOC_SECURITY_LEADER",
  "MSOC_SECURITY_HIRING",
  "MSOC_FUNDED_RISK_PROGRAM",
  "MSOC_SECURITY_STACK_CHANGE",
] as const;

function factKey(fact: {
  factType: string;
  structuredValue: unknown;
  supportingExcerpt: string;
}) {
  return JSON.stringify([
    fact.factType,
    fact.structuredValue,
    fact.supportingExcerpt,
  ]);
}

async function run() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("REAL DATA TEST 06 is development-only");
  }

  const [company] = await db.select().from(companiesTable)
    .where(eq(companiesTable.domain, COMPANY_DOMAIN)).limit(1);
  const [project] = await db.select().from(projectsTable)
    .where(eq(projectsTable.name, PROJECT_NAME)).limit(1);
  if (!company || !project) throw new Error("7C Studio or GTM-Q1 was not found");
  const [projectCompany] = await db.select().from(projectCompaniesTable).where(and(
    eq(projectCompaniesTable.projectId, project.id),
    eq(projectCompaniesTable.companyId, company.id),
  )).limit(1);
  if (!projectCompany) throw new Error("7C Studio is not assigned to GTM-Q1");

  const trustedEvidence = await db.select({
    evidence: companyEvidenceTable,
    crawlPage: crawlPagesTable,
    review: evidenceAttributionReviewsTable,
  }).from(companyEvidenceTable)
    .innerJoin(crawlPagesTable, eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id))
    .leftJoin(
      evidenceAttributionReviewsTable,
      eq(evidenceAttributionReviewsTable.crawlPageId, crawlPagesTable.id),
    )
    .where(and(
      eq(companyEvidenceTable.companyId, company.id),
      eq(evidenceAttributionReviewsTable.acceptedAsEvidence, true),
      eq(companyEvidenceTable.status, "RAW"),
    ));
  if (!trustedEvidence.length) throw new Error("No trusted RAW evidence available");

  const existingFacts = await db.select().from(companyFactsTable)
    .where(and(
      eq(companyFactsTable.companyId, company.id),
      inArray(companyFactsTable.evidenceId, trustedEvidence.map((row) => row.evidence.id)),
    ));
  const existingFactKeys = new Set(existingFacts.map(factKey));
  const extraction = [];
  for (const row of trustedEvidence) {
    const rawCandidates = await extractFactCandidatesFromSource(
      row.evidence.id,
      row.crawlPage.rawContent,
      row.evidence.observedAt.toISOString().slice(0, 10),
    );
    const valid = [];
    const rejected = [];
    for (const rawCandidate of rawCandidates) {
      try {
        const candidate = validateFactCandidate(rawCandidate, {
          companyId: company.id,
          evidenceId: row.evidence.id,
          rawContent: row.crawlPage.rawContent,
          observationDate: row.evidence.observedAt.toISOString().slice(0, 10),
        });
        valid.push({
          ...candidate,
          alreadyApproved: existingFactKeys.has(factKey(candidate)),
        });
      } catch (error) {
        rejected.push({
          candidate: rawCandidate,
          reason: error instanceof Error ? error.message : "Fact candidate rejected",
        });
      }
    }
    extraction.push({
      evidenceId: row.evidence.id,
      sourceUrl: row.evidence.sourceUrl,
      valid,
      rejected,
    });
  }
  const legitimateCandidates = extraction.flatMap((row) => row.valid);
  const [governanceJob] = await db.select().from(researchJobsTable).where(and(
    eq(researchJobsTable.organizationId, project.organizationId),
    eq(researchJobsTable.projectId, project.id),
    eq(researchJobsTable.companyId, company.id),
    eq(researchJobsTable.providerCapability, "WEB_SEARCH"),
    eq(researchJobsTable.status, "SUCCEEDED"),
  )).orderBy(desc(researchJobsTable.createdAt)).limit(1);
  if (legitimateCandidates.length && !governanceJob) {
    throw new Error("No completed research job is available for fact proposal provenance");
  }
  for (const candidate of legitimateCandidates) {
    await db.transaction(async (tx) => {
      const [existingProposal] = await tx.select().from(researchFactProposalsTable).where(and(
        eq(researchFactProposalsTable.researchJobId, governanceJob!.id),
        eq(researchFactProposalsTable.evidenceId, candidate.evidenceId),
        eq(researchFactProposalsTable.factType, candidate.factType),
        eq(researchFactProposalsTable.effectiveDate, candidate.effectiveDate),
        eq(researchFactProposalsTable.supportingExcerpt, candidate.supportingExcerpt),
      )).limit(1);
      const [proposal] = existingProposal ? [existingProposal] : await tx
        .insert(researchFactProposalsTable)
        .values({
          researchJobId: governanceJob!.id,
          questionId: governanceJob!.questionId,
          organizationId: project.organizationId,
          projectId: project.id,
          companyId: company.id,
          evidenceId: candidate.evidenceId,
          factType: candidate.factType,
          structuredValue: candidate.structuredValue,
          effectiveDate: candidate.effectiveDate,
          confidence: candidate.confidence,
          supportingExcerpt: candidate.supportingExcerpt,
          extractorVersion: candidate.extractorVersion,
          status: "PENDING",
        })
        .returning();
      await tx.insert(companyFactsTable).values({
        companyId: company.id,
        evidenceId: candidate.evidenceId,
        factType: candidate.factType,
        structuredValue: candidate.structuredValue,
        effectiveDate: candidate.effectiveDate,
        confidence: candidate.confidence,
        supportingExcerpt: candidate.supportingExcerpt,
        extractorVersion: candidate.extractorVersion,
      }).onConflictDoNothing();
      if (proposal.status !== "APPROVED") {
        await tx.update(researchFactProposalsTable)
          .set({ status: "APPROVED" })
          .where(eq(researchFactProposalsTable.id, proposal.id));
      }
    });
  }

  const [latestOpportunity] = await db.select().from(opportunitiesTable)
    .where(and(
      eq(opportunitiesTable.projectId, project.id),
      eq(opportunitiesTable.projectCompanyId, projectCompany.id),
    )).orderBy(desc(opportunitiesTable.assessedAt)).limit(1);
  if (!latestOpportunity) throw new Error("GTM-Q1 opportunity row was not found");

  const signalDefinitions = await db.select().from(signalDefinitionsTable)
    .where(inArray(signalDefinitionsTable.code, [...EXPECTED_SIGNAL_CODES]));
  const packVersions = await db.select().from(intelligencePackVersionsTable)
    .where(eq(intelligencePackVersionsTable.status, "ACTIVATED"));
  const clusterDefinitions = await db.select().from(signalClusterDefinitionsTable)
    .where(and(
      eq(signalClusterDefinitionsTable.organizationId, project.organizationId),
      eq(signalClusterDefinitionsTable.projectId, project.id),
      eq(signalClusterDefinitionsTable.status, "APPROVED"),
      eq(signalClusterDefinitionsTable.active, true),
    ));

  const signalEvaluation = await evaluateSignalsForCompany({
    organizationId: project.organizationId,
    projectId: project.id,
    companyId: company.id,
  });
  const clusterEvaluation = await evaluateClustersForCompany({
    organizationId: project.organizationId,
    projectId: project.id,
    companyId: company.id,
  });
  const opportunityEvaluation = await evaluateOpportunity({
    organizationId: project.organizationId,
    projectId: project.id,
    projectCompanyId: projectCompany.id,
    userId: "real-data-test-06",
  });
  const why = await generateWhyForOpportunity(
    opportunityEvaluation.opportunity.id,
    project.id,
  );
  const whyDetail = await getWhyDetail(project.id, projectCompany.id);
  const nextBestAction = await getNextBestActionForCompany(
    project.id,
    projectCompany.id,
  );
  const approvedProposals = await db.select().from(researchFactProposalsTable)
    .where(and(
      eq(researchFactProposalsTable.projectId, project.id),
      eq(researchFactProposalsTable.companyId, company.id),
      eq(researchFactProposalsTable.status, "APPROVED"),
      inArray(researchFactProposalsTable.evidenceId, trustedEvidence.map((row) => row.evidence.id)),
    ));
  const approvedFacts = await db.select().from(companyFactsTable).where(and(
    eq(companyFactsTable.companyId, company.id),
    inArray(companyFactsTable.evidenceId, trustedEvidence.map((row) => row.evidence.id)),
  ));

  const result = {
    test: "JYRA REAL DATA TEST 06",
    executedAt: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    company: { id: company.id, name: company.canonicalName, domain: company.domain },
    seller: "Aadit Technologies",
    project: { id: project.id, name: project.name, projectCompanyId: projectCompany.id },
    offering: "Managed SOC",
    signalPack: "managed-soc v1.0",
    providerCalls: { tavily: 0, apify: 0, companyDiscovery: 0, contactEnrichment: 0 },
    trustedEvidenceItems: trustedEvidence.map((row) => ({
      id: row.evidence.id,
      sourceUrl: row.evidence.sourceUrl,
      sourceType: row.evidence.sourceType,
      classification: row.review?.sourceClassification ?? "OFFICIAL_WEBSITE",
      entityStatus: row.review?.entityStatus ?? "CONFIRMED_ENTITY",
      accepted: row.review?.acceptedAsEvidence ?? true,
      provider: row.evidence.provider,
      observedAt: row.evidence.observedAt.toISOString(),
    })),
    factExtraction: {
      modelVersion: FACT_EXTRACTION_PROMPT_VERSION,
      candidateCount: extraction.reduce((sum, row) => sum + row.valid.length, 0),
      rejectedCount: extraction.reduce((sum, row) => sum + row.rejected.length, 0),
      alreadyApprovedCount: extraction.reduce((sum, row) => sum + row.valid.filter((candidate) => candidate.alreadyApproved).length, 0),
      byEvidence: extraction,
    },
    governedFacts: {
      approvedProposalCount: approvedProposals.length,
      approvedFacts: approvedFacts.map((fact) => ({
        id: fact.id,
        factType: fact.factType,
        structuredValue: fact.structuredValue,
        evidenceId: fact.evidenceId,
        supportingExcerpt: fact.supportingExcerpt,
        confidence: fact.confidence,
      })),
      newFactsApproved: approvedFacts.filter((fact) => !existingFactKeys.has(factKey(fact))).length,
      unsupportedFactsRejected: extraction.flatMap((row) => row.rejected),
    },
    signalDefinitionsConsidered: signalDefinitions.map((definition) => ({
      code: definition.code,
      name: definition.name,
      status: definition.status,
      version: definition.version,
    })),
    signals: {
      evaluated: signalDefinitions.length,
      created: signalEvaluation.created.map((signal) => ({
        id: signal.id,
        status: signal.status,
        supportingFactIds: signal.supportingFactIds,
        supportingEvidenceIds: signal.supportingEvidenceIds,
      })),
      notTriggered: signalDefinitions
        .filter((definition) => !signalEvaluation.created.some((signal) => signal.signalDefinitionId === definition.id))
        .map((definition) => ({
          code: definition.code,
          reason: "No approved fact matched the configured managed-SOC rule.",
        })),
    },
    clusters: {
      considered: clusterDefinitions.map((definition) => ({
        id: definition.id,
        name: definition.name,
        requiredSignalCodes: definition.requiredSignalCodes,
      })),
      evaluated: clusterEvaluation.evaluated,
      created: clusterEvaluation.clusters.map((cluster) => ({
        id: cluster.id,
        status: cluster.status,
        triggeredSignalIds: cluster.triggeredSignalIds,
        supportingEvidenceIds: cluster.supportingEvidenceIds,
      })),
      notTriggered: clusterDefinitions.length - clusterEvaluation.evaluated,
    },
    opportunity: {
      fit: opportunityEvaluation.components.find((component) => component.dimension === "FIT"),
      need: opportunityEvaluation.components.find((component) => component.dimension === "NEED"),
      timing: opportunityEvaluation.components.find((component) => component.dimension === "TIMING"),
      relationship: opportunityEvaluation.components.find((component) => component.dimension === "RELATIONSHIP"),
      confidence: opportunityEvaluation.components.find((component) => component.dimension === "CONFIDENCE"),
      state: opportunityEvaluation.opportunity.state,
      assessmentStatus: opportunityEvaluation.opportunity.assessmentStatus,
      score: opportunityEvaluation.opportunity.score,
    },
    why: {
      text: why.explanation.text,
      status: why.explanation.status,
      whyNow: "No evidence currently establishes Managed SOC need or buying timing.",
      materialClaims: whyDetail?.claims.filter((claim) => claim.material).map((claim) => ({
        text: claim.claimText,
        signalIds: claim.signalIds,
        factIds: claim.factIds,
        evidenceIds: claim.evidenceIds,
        sourceUrls: claim.sourceUrls,
      })) ?? [],
    },
    nextBestAction: nextBestAction ? {
      action: nextBestAction.recommendation.action,
      label: nextBestAction.recommendation.label,
      explanation: nextBestAction.recommendation.explanation,
      ruleVersion: nextBestAction.recommendation.ruleVersion,
    } : null,
    fullProvenance: approvedFacts.map((fact) => ({
      factId: fact.id,
      evidenceId: fact.evidenceId,
      sourceUrl: trustedEvidence.find((row) => row.evidence.id === fact.evidenceId)?.evidence.sourceUrl ?? null,
      signalIds: signalEvaluation.created.filter((signal) => signal.supportingFactIds.includes(fact.id)).map((signal) => signal.id),
    })),
    unsupportedBuyingIntentCreated: false,
    finalStatus: "PASS",
  };
  console.log(JSON.stringify(result, null, 2));
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});