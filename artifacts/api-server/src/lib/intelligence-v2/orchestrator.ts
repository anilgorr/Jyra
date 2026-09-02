import { assessmentFingerprintV2, fingerprintV2 } from "./fingerprint";
import { resolveCompanyV2 } from "./resolve-company";
import { researchCompanyV2, type ResearchInvokerV2, type ResearchRequestV2 } from "./research-company";
import { buildCompanyProfileV2 } from "./build-company-profile";
import { assessMarketFitV2, type AssessmentInvokerV2 } from "./assess-market-fit";
import { applySafetyRulesV2 } from "./apply-safety-rules";
import { normalizeAssessmentEvidenceV2, validateAssessmentEvidenceV2 } from "./evidence-validator";
import {
  ASSESSMENT_MODEL, ASSESSMENT_POLICY_VERSION, ASSESSMENT_PROMPT_VERSION, INTELLIGENCE_CORE_VERSION,
  evidenceItemSchema, sellerRelativeContextSchema, type CompanyIntelligenceProfileV2, type EvidenceItemV2, type FinalAssessmentV2,
  researchRequirementSchema, type ResearchPackageV2, type SellerRelativeAssessmentV2, type SellerRelativeContextV2,
} from "./schemas";

export type IntelligenceV2Repository = {
  getResearch(key: string): Promise<ResearchPackageV2 | null>;
  putResearch(key: string, value: ResearchPackageV2): Promise<void>;
  getProfile(fingerprint: string): Promise<CompanyIntelligenceProfileV2 | null>;
  putProfile(fingerprint: string, value: CompanyIntelligenceProfileV2): Promise<void>;
  getAssessment(fingerprint: string): Promise<SellerRelativeAssessmentV2 | null>;
  putAssessment(fingerprint: string, value: SellerRelativeAssessmentV2): Promise<void>;
};

export class InMemoryIntelligenceV2Repository implements IntelligenceV2Repository {
  private research = new Map<string, ResearchPackageV2>();
  private profiles = new Map<string, CompanyIntelligenceProfileV2>();
  private assessments = new Map<string, SellerRelativeAssessmentV2>();
  async getResearch(key: string) { return this.research.get(key) ?? null; }
  async putResearch(key: string, value: ResearchPackageV2) { this.research.set(key, value); }
  async getProfile(key: string) { return this.profiles.get(key) ?? null; }
  async putProfile(key: string, value: CompanyIntelligenceProfileV2) { this.profiles.set(key, value); }
  async getAssessment(key: string) { return this.assessments.get(key) ?? null; }
  async putAssessment(key: string, value: SellerRelativeAssessmentV2) { this.assessments.set(key, value); }
}

export type IntelligenceV2Result = {
  intelligenceVersion: typeof INTELLIGENCE_CORE_VERSION;
  profile: CompanyIntelligenceProfileV2;
  assessment: FinalAssessmentV2;
  evidence: EvidenceItemV2[];
  observability: {
    profileFingerprint: string; assessmentFingerprint: string; researchActions: ResearchPackageV2["actions"];
    evidenceCount: number; researchProviderCalls: number; modelCalls: number; modelTokens: number; providerCost: number; modelCost: number;
    semanticAttempts: Array<{ attempt: number; durationMs: number; outcome: string; usage: Record<string, unknown> | null; cost: number }>;
    totalCost: number; cache: { research: boolean; profile: boolean; assessment: boolean }; durationMs: number;
  };
};

/** Production always remains V1. Development must opt in explicitly. */
export function selectedIntelligenceVersionV2(env: NodeJS.ProcessEnv = process.env): "V1" | typeof INTELLIGENCE_CORE_VERSION {
  return env.NODE_ENV !== "production" && env.JYRA_INTELLIGENCE_VERSION === INTELLIGENCE_CORE_VERSION
    ? INTELLIGENCE_CORE_VERSION
    : "V1";
}
/** Converts the selected ICP's structured criteria plus offering outcomes into
 * research requirements; callers cannot inject an unrelated type list. */
export function deriveResearchRequirementsV2(context: SellerRelativeContextV2) {
  const raw = context.icp.requirements;
  const icp = Array.isArray(raw) ? raw.map((item) => researchRequirementSchema.parse(item)) : [];
  const outcomes = Array.isArray(context.offering.materialCapabilities)
    ? context.offering.materialCapabilities.filter((value): value is string => typeof value === "string")
    : [];
  return [...icp, ...outcomes.map((value, index) => researchRequirementSchema.parse({
    criterionId: `offering-outcome-${index}`, type: "OFFERING_OVERLAP", operator: "CONTAINS", value, mandatory: false, exclusion: false, preferred: true,
  }))];
}

const inFlightRuns = new Map<string, Promise<IntelligenceV2Result>>();

export function validateScopedEvidence(items: EvidenceItemV2[], request: { organizationId: string; projectId: string; companyId: string }, source: string) {
  const evidenceIds = new Set<string>();
  const claimIds = new Set<string>();
  for (const item of items) {
    evidenceItemSchema.parse(item);
    if (item.organizationId !== request.organizationId || item.projectId !== request.projectId || item.companyId !== request.companyId) {
      throw new Error(`V2_EVIDENCE_SCOPE_MISMATCH:${source}`);
    }
    if (evidenceIds.has(item.evidenceId)) throw new Error(`V2_DUPLICATE_EVIDENCE_ID:${source}`);
    evidenceIds.add(item.evidenceId);
    for (const claim of item.atomicClaims) {
      if (claimIds.has(claim.claimId)) throw new Error(`V2_DUPLICATE_CLAIM_ID:${source}`);
      claimIds.add(claim.claimId);
    }
  }
}

export async function orchestrateIntelligenceV2(input: {
  request: ResearchRequestV2 & { source: string; firstPartyEvidence: EvidenceItemV2[]; contradictoryEvidence?: EvidenceItemV2[] };
  context: SellerRelativeContextV2; repository: IntelligenceV2Repository;
  researchInvoker: ResearchInvokerV2; assessmentInvoker?: AssessmentInvokerV2; now?: Date;
  maxExternalResearchCalls?: number; assessmentTimeoutMs?: number;
  onSemanticAttemptStart?: () => void; onSemanticCost?: (cost: number) => void;
}): Promise<IntelligenceV2Result> {
  const key = fingerprintV2({ organizationId: input.request.organizationId, projectId: input.request.projectId, companyId: input.request.companyId,
    domain: input.request.domain, sourceEvidence: input.request.firstPartyEvidence.map(({ evidenceId, version }) => ({ evidenceId, version })),
    businessTwinVersion: input.context.businessTwinVersion, offeringVersion: input.context.offeringVersion, icpVersion: input.context.icpVersion,
    assessmentPolicyVersion: ASSESSMENT_POLICY_VERSION, promptVersion: ASSESSMENT_PROMPT_VERSION, model: ASSESSMENT_MODEL });
  const active = inFlightRuns.get(key);
  if (active) return active;
  const work = orchestrateIntelligenceV2Internal(input).finally(() => inFlightRuns.delete(key));
  inFlightRuns.set(key, work);
  return work;
}

async function orchestrateIntelligenceV2Internal(input: {
  request: ResearchRequestV2 & { source: string; firstPartyEvidence: EvidenceItemV2[]; contradictoryEvidence?: EvidenceItemV2[] };
  context: SellerRelativeContextV2; repository: IntelligenceV2Repository;
  researchInvoker: ResearchInvokerV2; assessmentInvoker?: AssessmentInvokerV2; now?: Date;
  maxExternalResearchCalls?: number; assessmentTimeoutMs?: number;
  onSemanticAttemptStart?: () => void; onSemanticCost?: (cost: number) => void;
}): Promise<IntelligenceV2Result> {
  const started = Date.now();
  sellerRelativeContextSchema.parse(input.context);
  if (input.context.projectId !== input.request.projectId) throw new Error("V2_PROJECT_CONTEXT_MISMATCH");
  if (input.context.organizationId !== input.request.organizationId) throw new Error("V2_ORGANIZATION_CONTEXT_MISMATCH");
  if (selectedIntelligenceVersionV2() !== INTELLIGENCE_CORE_VERSION) throw new Error("V2_NOT_SELECTED_IN_NON_PRODUCTION");
  validateScopedEvidence(input.request.firstPartyEvidence, input.request, "seed");
  validateScopedEvidence(input.request.contradictoryEvidence ?? [], input.request, "contradictory");
  const researchKey = fingerprintV2({
    organizationId: input.request.organizationId, projectId: input.request.projectId, companyId: input.request.companyId,
    domain: input.request.domain,
    seedEvidence: input.request.firstPartyEvidence.map(({ evidenceId, version }) => ({ evidenceId, version })),
  });
  let research = await input.repository.getResearch(researchKey);
  const researchHit = Boolean(research);
  if (research) {
    if (research.organizationId !== input.request.organizationId || research.projectId !== input.request.projectId || research.companyId !== input.request.companyId) throw new Error("V2_RESEARCH_SCOPE_MISMATCH:cache");
    validateScopedEvidence(research.evidence, input.request, "cached-research");
  }
  if (!research) {
    research = await researchCompanyV2({ ...input.request, requirements: deriveResearchRequirementsV2(input.context) }, async (step, request) => {
      if (step.source === "CACHE") return { provider: "request-evidence", evidence: input.request.firstPartyEvidence };
      return input.researchInvoker(step, request);
    }, input.maxExternalResearchCalls);
    if (research.organizationId !== input.request.organizationId || research.projectId !== input.request.projectId || research.companyId !== input.request.companyId) throw new Error("V2_RESEARCH_SCOPE_MISMATCH:researched");
    validateScopedEvidence(research.evidence, input.request, "researched");
    await input.repository.putResearch(researchKey, research);
  }
  const identity = resolveCompanyV2({
    companyName: input.request.companyName, domain: input.request.domain, source: input.request.source,
    firstPartyEvidence: research.evidence.filter((item) => item.firstParty),
    contradictoryEvidence: input.request.contradictoryEvidence,
  });
  const allEvidence = [...research.evidence, ...(input.request.contradictoryEvidence ?? [])];
  validateScopedEvidence(allEvidence, input.request, "all-evidence");
  const expectedProfile = buildCompanyProfileV2({
    organizationId: input.request.organizationId, projectId: input.request.projectId, companyId: input.request.companyId, identity, evidence: allEvidence, now: input.now,
  });
  let profile = await input.repository.getProfile(expectedProfile.fingerprint);
  const profileHit = Boolean(profile);
  if (profile && (profile.organizationId !== input.request.organizationId || profile.projectId !== input.request.projectId || profile.companyId !== input.request.companyId)) throw new Error("V2_PROFILE_SCOPE_MISMATCH");
  if (!profile) {
    profile = expectedProfile;
    await input.repository.putProfile(profile.fingerprint, profile);
  }
  const assessmentFingerprint = assessmentFingerprintV2({
    organizationId: input.context.organizationId, projectId: input.context.projectId,
    profileFingerprint: profile.fingerprint, businessTwinVersion: input.context.businessTwinVersion,
    offeringVersion: input.context.offeringVersion, icpVersion: input.context.icpVersion,
    assessmentPolicyVersion: ASSESSMENT_POLICY_VERSION, promptVersion: ASSESSMENT_PROMPT_VERSION, model: ASSESSMENT_MODEL,
  });
  let semantic = await input.repository.getAssessment(assessmentFingerprint);
  const assessmentHit = Boolean(semantic);
  let usage: Record<string, unknown> | null = null;
  let modelCost = 0;
  let modelCalls = 0;
  let semanticAttempts: IntelligenceV2Result["observability"]["semanticAttempts"] = [];
  if (!semantic) {
    const result = await assessMarketFitV2({
      context: input.context, profile, evidence: allEvidence,
      invoke: input.assessmentInvoker, timeoutMs: input.assessmentTimeoutMs,
      onAttemptStart: input.onSemanticAttemptStart, onCost: input.onSemanticCost,
    });
    semantic = result.assessment; usage = result.usage; modelCost = result.cost; modelCalls = result.modelCalls; semanticAttempts = result.attempts;
    await input.repository.putAssessment(assessmentFingerprint, semantic);
  }
  try {
    semantic = normalizeAssessmentEvidenceV2(semantic, allEvidence, input.context);
  } catch (error) {
    throw new Error(`V2_CACHED_ASSESSMENT_INVALID: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const semanticValidation = validateAssessmentEvidenceV2(semantic, allEvidence, input.context);
  if (!semanticValidation.ok) throw new Error(`V2_CACHED_ASSESSMENT_INVALID: ${semanticValidation.errors.join("; ")}`);
  semantic = semanticValidation.assessment;
  const assessment = applySafetyRulesV2({ profile, assessment: semantic, fingerprint: assessmentFingerprint });
  const { resolutionType: _resolutionType, deterministicOverrides: _deterministicOverrides, safetyOverrideMetadata: _safetyOverrideMetadata, fingerprint: _fingerprint, ...finalSemantic } = assessment;
  const finalValidation = validateAssessmentEvidenceV2(finalSemantic, allEvidence, input.context);
  if (!finalValidation.ok) throw new Error(`V2_FINAL_ASSESSMENT_INVALID: ${finalValidation.errors.join("; ")}`);
  const modelTokens = typeof usage?.total_tokens === "number" && Number.isFinite(usage.total_tokens) ? usage.total_tokens : 0;
  return {
    intelligenceVersion: INTELLIGENCE_CORE_VERSION, profile, assessment, evidence: allEvidence,
    observability: {
      profileFingerprint: profile.fingerprint, assessmentFingerprint, researchActions: research.actions,
      evidenceCount: allEvidence.length, researchProviderCalls: researchHit ? 0 : research.externalCalls,
      modelCalls: assessmentHit ? 0 : modelCalls, modelTokens: assessmentHit ? 0 : modelTokens, semanticAttempts,
      providerCost: researchHit ? 0 : research.providerCost,
      modelCost, totalCost: (researchHit ? 0 : research.providerCost) + modelCost,
      cache: { research: researchHit, profile: profileHit, assessment: assessmentHit },
      durationMs: Math.max(0, Date.now() - started),
    },
  };
}