import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  AnalyzeCompanyIntelligenceV2Body,
  AnalyzeCompanyIntelligenceV2Params,
  AnalyzeCompanyIntelligenceV2Response,
  GetCompanyIntelligenceV2Params,
  GetCompanyIntelligenceV2Response,
} from "@workspace/api-zod";
import {
  companiesTable,
  db,
  icpCriteriaTable,
  organizationMembersTable,
  projectCompaniesTable,
  projectsTable,
} from "@workspace/db";
import { evaluateOpportunity } from "../lib/opportunity-engine";
import { ProviderRouter } from "../lib/provider-router";
import { resolveProjectSellerContext } from "../lib/seller-context";
import {
  InMemoryIntelligenceV2Repository,
  orchestrateIntelligenceV2,
  type IntelligenceV2Result,
} from "../lib/intelligence-v2/orchestrator";
import { createProviderRouterResearchInvokerV2 } from "../lib/intelligence-v2/research-company";
import { icpCriteriaToRequirementsV2 } from "../lib/intelligence-v2/icp-requirements";
import {
  loadLatestIntelligenceV2Assessment,
  persistIntelligenceV2Assessment,
} from "../lib/intelligence-v2/persist-assessment";
import {
  ASSESSMENT_POLICY_VERSION,
  ASSESSMENT_PROMPT_VERSION,
  COMPANY_PROFILE_VERSION,
  INTELLIGENCE_CORE_VERSION,
  SAFETY_POLICY_VERSION,
  type EvidenceItemV2,
} from "../lib/intelligence-v2/schemas";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

// The research/profile/assessment caches stay process-private (they hold raw
// provider payloads). Completed run outcomes are persisted to
// intelligence_v2_assessments; `latestRuns` remains as the hot path for the
// development panel within one process.
const repository = new InMemoryIntelligenceV2Repository();
const latestRuns = new Map<string, ReturnType<typeof compactRun>>();
const keyFor = (projectId: string, projectCompanyId: string) => `${projectId}:${projectCompanyId}`;
/** The legacy evidence model is canonical-company scoped. It is never an
 * authorized V2 seed because there is no project-private provenance relation. */
export const legacySeedEvidenceForV2 = (): [] => [];

function enabled() {
  return process.env.NODE_ENV === "development"
    && process.env.JYRA_INTELLIGENCE_VERSION === INTELLIGENCE_CORE_VERSION;
}

async function resolveOwnedCompany(userId: string, projectId: string, projectCompanyId: string) {
  const [row] = await db.select({
    project: projectsTable,
    projectCompany: projectCompaniesTable,
    company: companiesTable,
  }).from(projectCompaniesTable)
    .innerJoin(projectsTable, eq(projectsTable.id, projectCompaniesTable.projectId))
    .innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .innerJoin(organizationMembersTable, and(
      eq(organizationMembersTable.organizationId, projectsTable.organizationId),
      eq(organizationMembersTable.userId, userId),
    ))
    .where(and(
      eq(projectCompaniesTable.id, projectCompanyId),
      eq(projectCompaniesTable.projectId, projectId),
    )).limit(1);
  return row ?? null;
}

function compactRun(
  result: IntelligenceV2Result,
  projectCompanyId: string,
  contextVersions: { businessTwin: string; offering: string; icp: string },
  evidence: EvidenceItemV2[],
) {
  return {
    intelligenceVersion: result.intelligenceVersion,
    projectId: result.profile.projectId,
    projectCompanyId,
    companyId: result.profile.companyId,
    companyName: result.profile.companyName,
    domain: result.profile.domain,
    createdAt: result.profile.createdAt,
    identity: result.profile.identity,
    primaryBusiness: result.profile.primaryBusiness,
    commercialRole: {
      value: result.assessment.commercialRole.value,
      confidence: result.assessment.commercialRole.confidence,
      reason: result.assessment.commercialRole.reason,
      evidenceIds: result.assessment.commercialRole.evidenceIds,
      claimIds: result.assessment.commercialRole.claimIds,
      claimBindings: result.assessment.commercialRole.claimBindings,
    },
    who: {
      value: result.assessment.who.value,
      confidence: result.assessment.who.confidence,
      reason: result.assessment.who.reason,
      evidenceIds: result.assessment.who.evidenceIds,
      claimIds: result.assessment.who.claimIds,
      claimBindings: result.assessment.who.claimBindings,
      criteria: result.assessment.who.criteria,
    },
    assessmentConfidence: result.assessment.assessmentConfidence,
    resolutionType: result.assessment.resolutionType,
    deterministicOverrides: result.assessment.deterministicOverrides,
    unknownFacts: result.profile.unknownFields,
    evidence: evidence.map((item) => ({
      evidenceId: item.evidenceId,
      sourceType: item.sourceType,
      provider: item.provider,
      url: item.url,
      title: item.title,
      observedAt: item.observedAt,
      statement: item.rawSnippet,
      firstParty: item.firstParty,
      confidence: item.confidence,
      version: item.version,
    })),
    cost: {
      provider: result.observability.providerCost,
      model: result.observability.modelCost,
      total: result.observability.totalCost,
      researchProviderCalls: result.observability.researchProviderCalls,
      modelCalls: result.observability.modelCalls,
    },
    versions: {
      profile: COMPANY_PROFILE_VERSION,
      assessmentPolicy: ASSESSMENT_POLICY_VERSION,
      assessmentPrompt: ASSESSMENT_PROMPT_VERSION,
      safetyPolicy: SAFETY_POLICY_VERSION,
      ...contextVersions,
    },
    fingerprints: {
      profile: result.observability.profileFingerprint,
      assessment: result.observability.assessmentFingerprint,
    },
  };
}

router.get("/projects/:projectId/companies/:projectCompanyId/intelligence-v2", requireAuth, asyncRoute(async (req, res) => {
  if (!enabled()) return void res.status(404).json({ error: "Not found" });
  const params = GetCompanyIntelligenceV2Params.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project company not found" });
  const owned = await resolveOwnedCompany(getAuthenticatedUserId(res), params.data.projectId, params.data.projectCompanyId);
  if (!owned) return void res.status(404).json({ error: "Project company not found" });
  const run = latestRuns.get(keyFor(params.data.projectId, params.data.projectCompanyId));
  if (run) return void res.json(GetCompanyIntelligenceV2Response.parse(run));
  // Restart-safe fallback: serve the newest persisted run verbatim. A snapshot
  // that no longer satisfies the current contract is reported as absent rather
  // than returned malformed.
  const persisted = await loadLatestIntelligenceV2Assessment(params.data.projectId, params.data.projectCompanyId);
  if (!persisted) return void res.status(404).json({ error: "No V2 analysis has been run for this company" });
  const parsed = GetCompanyIntelligenceV2Response.safeParse(persisted.runSnapshot);
  if (!parsed.success) {
    req.log.warn({
      assessmentId: persisted.id,
      projectCompanyId: params.data.projectCompanyId,
      issues: parsed.error.issues.slice(0, 5),
    }, "Persisted Intelligence Core V2 run does not satisfy the current response contract");
    return void res.status(404).json({ error: "The persisted V2 analysis predates the current response contract" });
  }
  res.json(parsed.data);
}));

router.post("/projects/:projectId/companies/:projectCompanyId/intelligence-v2", requireAuth, asyncRoute(async (req, res) => {
  if (!enabled()) return void res.status(404).json({ error: "Not found" });
  const params = AnalyzeCompanyIntelligenceV2Params.safeParse(req.params);
  const body = AnalyzeCompanyIntelligenceV2Body.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: "Invalid V2 analysis request" });
  const owned = await resolveOwnedCompany(getAuthenticatedUserId(res), params.data.projectId, params.data.projectCompanyId);
  if (!owned) return void res.status(404).json({ error: "Project company not found" });

  const seller = await resolveProjectSellerContext(params.data.projectId, owned.project.organizationId);
  if (!seller.businessTwinReady || !seller.offeringReady || !seller.icpReady
    || !seller.businessTwinVersionId || !seller.icpVersionId) {
    return void res.status(409).json({ error: `Current seller context is incomplete: ${seller.missingRequirements.join(", ")}` });
  }
  const criteria = await db.select().from(icpCriteriaTable).where(and(
      eq(icpCriteriaTable.projectId, params.data.projectId),
      eq(icpCriteriaTable.icpVersionId, seller.icpVersionId),
      eq(icpCriteriaTable.accepted, true),
    ));
  const requirements = icpCriteriaToRequirementsV2(criteria);
  const result = await orchestrateIntelligenceV2({
    request: {
      organizationId: owned.project.organizationId,
      projectId: params.data.projectId,
      companyId: owned.company.id,
      companyName: owned.company.canonicalName,
      domain: owned.company.domain,
      source: "EXISTING_COMPANY",
      firstPartyEvidence: legacySeedEvidenceForV2(),
    },
    context: {
      organizationId: owned.project.organizationId,
      projectId: params.data.projectId,
      businessTwinVersion: seller.businessTwinVersionId,
      offeringVersion: seller.opportunityPackVersionId ?? seller.context.fingerprint,
      icpVersion: seller.icpVersionId,
      sellerBusinessTwin: {
        rawAnswers: seller.businessTwinRawAnswers,
        interpretation: seller.businessTwinAiInterpretation,
      },
      offering: {
        name: seller.context.offeringName,
        description: seller.context.offeringDescription,
        materialCapabilities: seller.context.offeringCapabilities,
        exclusions: seller.context.offeringExclusions,
      },
      icp: { requirements, assumptions: seller.icpAssumptions },
    },
    repository,
    researchInvoker: createProviderRouterResearchInvokerV2(new ProviderRouter()),
  });
  const run = compactRun(result, params.data.projectCompanyId, {
    businessTwin: seller.businessTwinVersionId,
    offering: seller.opportunityPackVersionId ?? seller.context.fingerprint,
    icp: seller.icpVersionId,
  }, result.evidence);
  latestRuns.set(keyFor(params.data.projectId, params.data.projectCompanyId), run);
  const completedAt = new Date();
  const persisted = await db.transaction(async (tx) => {
    const row = await persistIntelligenceV2Assessment({
      organizationId: owned.project.organizationId,
      projectId: params.data.projectId,
      projectCompanyId: params.data.projectCompanyId,
      companyId: owned.company.id,
      icpVersionId: seller.icpVersionId ?? null,
      result,
      runSnapshot: run,
    }, tx);
    await tx.update(projectCompaniesTable).set({
      researchStatus: "complete",
      latestResearchAt: completedAt,
      updatedAt: completedAt,
    }).where(eq(projectCompaniesTable.id, params.data.projectCompanyId));
    return row;
  });
  // Refresh the deterministic opportunity assessment so Today / Opportunities /
  // Companies reflect this run immediately. Scoring is downstream of the
  // persisted verdicts; its failure must never turn a completed run into an error.
  try {
    await evaluateOpportunity({
      organizationId: owned.project.organizationId,
      projectId: params.data.projectId,
      projectCompanyId: params.data.projectCompanyId,
      userId: getAuthenticatedUserId(res),
      now: completedAt,
    });
  } catch (error) {
    req.log.warn({
      err: error,
      assessmentId: persisted.id,
      projectCompanyId: params.data.projectCompanyId,
    }, "Opportunity re-evaluation after Intelligence Core V2 run failed; the persisted assessment is unaffected");
  }
  req.log.info({
    assessmentId: persisted.id,
    companyId: run.companyId,
    intelligenceVersion: run.intelligenceVersion,
    profileFingerprint: run.fingerprints.profile,
    assessmentFingerprint: run.fingerprints.assessment,
    evidenceCount: result.observability.evidenceCount,
    researchProviderCalls: result.observability.researchProviderCalls,
    modelCalls: result.observability.modelCalls,
    commercialRole: run.commercialRole.value,
    who: run.who.value,
    confidence: result.assessment.assessmentConfidence,
    deterministicOverrides: result.assessment.deterministicOverrides,
    cost: run.cost.total,
    duration: result.observability.durationMs,
  }, "Completed development Intelligence Core V2 run");
  res.json(AnalyzeCompanyIntelligenceV2Response.parse(run));
}));

export default router;