import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { companiesTable, companyProvenanceTable, db, projectCompaniesTable } from "@workspace/db";
import { getCanonicalCompanyProfile } from "./canonical-company-profile";
import {
  assessCompanySemantically,
  buildCandidateEvidence,
  COMPANY_UNDERSTANDING_MODEL,
  COMPANY_UNDERSTANDING_NORMALIZATION_VERSION,
  COMPANY_UNDERSTANDING_PROMPT_VERSION,
  semanticFingerprint,
} from "./company-semantic-assessment";
import { ensureMinimumCompanyIntelligence, type MinimumCompanyIntelligence } from "./minimum-company-intelligence";
import type { ProviderOperations } from "./provider-contract";
import { resolveProjectSellerContext } from "./seller-context";
import type { BuyerRoleAssessment, CommercialRoleWhoResolution } from "./buyer-role-resolution";
import {
  qualifyProjectCompanyForWho,
  type IcpMissingDimension,
  type IcpMissingReasonCode,
} from "./company-discovery";

export const COMPANY_INTELLIGENCE_CONTROL_PLANE_VERSION = "architecture-v1-control-plane-v3";
export const COMMERCIAL_ROLE_WHO_POLICY_VERSION = "commercial-role-who-exclusion-v1";

export type CompanyIntelligenceWhoResult = Awaited<ReturnType<typeof qualifyProjectCompanyForWho>> & {
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  resolutionType?: "COMMERCIAL_ROLE_EXCLUSION" | "ICP_EVALUATION";
  sourceCommercialRole?: "SELLER_COMPETITOR";
  reason?: string;
  evidenceIds?: string[];
  policyVersion?: typeof COMMERCIAL_ROLE_WHO_POLICY_VERSION;
};

export type CompanyIntelligenceReasonCode =
  | "READY_FOR_SIGNAL_RESEARCH"
  | "SELLER_CONTEXT_INSUFFICIENT"
  | "IDENTITY_CONFLICT"
  | "WRONG_ENTITY"
  | "NOT_A_COMPANY"
  | "DOMAIN_MISSING"
  | "IDENTITY_EVIDENCE_INSUFFICIENT"
  | "COMPANY_PROFILE_MISSING"
  | "COMMERCIAL_RELATIONSHIP_AMBIGUOUS"
  | "COMPETITOR_NOT_ELIGIBLE"
  | "ADJACENT_VENDOR_NOT_ELIGIBLE"
  | "PARTNER_NOT_ELIGIBLE"
  | "ICP_REQUIREMENTS_MISSING"
  | "ICP_NOT_FIT";

export type CompanyIntelligenceControlResult = {
  version: typeof COMPANY_INTELLIGENCE_CONTROL_PLANE_VERSION;
  status: "SUCCESS" | "PARTIAL" | "INSUFFICIENT" | "BLOCKED";
  reasonCode: CompanyIntelligenceReasonCode;
  explanation: string;
  missingRequirements: string[];
  nextRecommendedCapability: string | null;
  missingIcpDimensions: IcpMissingDimension[];
  missingIcpReasonCodes: IcpMissingReasonCode[];
  retrySensible: boolean;
  manualReviewHelpful: boolean;
  minimumIntelligence: MinimumCompanyIntelligence | null;
  buyerRole: string;
  who: CompanyIntelligenceWhoResult | null;
  semantic: {
    cacheHit: boolean;
    llmInvoked: boolean;
    unknownReason: string | null;
    reusedPersistedAssessment: boolean;
    output: unknown;
    usage: Record<string, unknown> | null;
  } | null;
};

type ControlResultInput = Omit<
  CompanyIntelligenceControlResult,
  "version" | "missingIcpDimensions" | "missingIcpReasonCodes"
> & Partial<Pick<CompanyIntelligenceControlResult, "missingIcpDimensions" | "missingIcpReasonCodes">>;
function result(value: ControlResultInput): CompanyIntelligenceControlResult {
  return {
    version: COMPANY_INTELLIGENCE_CONTROL_PLANE_VERSION,
    missingIcpDimensions: [],
    missingIcpReasonCodes: [],
    ...value,
  };
}

function assessmentEvidenceIds(assessment: BuyerRoleAssessment): string[] {
  return [...new Set(assessment.supportingInputs
    .map((item) => item.excerpt)
    .filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))]
    .sort();
}

export function resolveWhoFromCommercialRole(
  assessment: BuyerRoleAssessment,
): CommercialRoleWhoResolution | null {
  if (assessment.buyerRole !== "SELLER_COMPETITOR") return null;
  return {
    qualification: "LIKELY_NOT_FIT",
    confidence: assessment.confidence,
    resolutionType: "COMMERCIAL_ROLE_EXCLUSION",
    sourceCommercialRole: "SELLER_COMPETITOR",
    reason: "The company is classified as a seller competitor for this offering and is therefore not eligible for buyer targeting.",
    evidenceIds: assessmentEvidenceIds(assessment),
    policyVersion: COMMERCIAL_ROLE_WHO_POLICY_VERSION,
  };
}

function exclusionWhoResult(resolution: CommercialRoleWhoResolution): CompanyIntelligenceWhoResult {
  return {
    ...resolution,
    eligible: false,
    checks: null,
    missingDimensions: [],
    missingReasonCodes: [],
    missingReasonCode: null,
    missingRequirements: [],
    firmographicResolutionAvailable: false,
  };
}

export function shouldRecommendCompanyFirmographics(who: Pick<
  NonNullable<CompanyIntelligenceControlResult["who"]>,
  "qualification" | "firmographicResolutionAvailable"
>): boolean {
  return who.qualification === "INSUFFICIENT_DATA" && who.firmographicResolutionAvailable;
}

export function controlPlaneFingerprint(input: {
  projectId: string;
  companyId: string;
  sellerContextFingerprint: string;
  semanticInputFingerprint: string;
  profile: Awaited<ReturnType<typeof getCanonicalCompanyProfile>>;
}): string {
  return createHash("sha256").update(JSON.stringify({
    version: COMPANY_INTELLIGENCE_CONTROL_PLANE_VERSION,
    projectId: input.projectId,
    companyId: input.companyId,
    sellerContextFingerprint: input.sellerContextFingerprint,
    semanticInputFingerprint: input.semanticInputFingerprint,
    profile: {
      canonicalName: input.profile.canonicalName,
      domain: input.profile.domain,
      primaryBusinessDescription: input.profile.primaryBusinessDescription,
      businessModel: input.profile.businessModel,
      canonicalIndustry: input.profile.canonicalIndustry,
      country: input.profile.country,
      employeesExact: input.profile.employeesExact,
      employeesMin: input.profile.employeesMin,
      employeesMax: input.profile.employeesMax,
      productsServices: input.profile.productsServices,
    },
  })).digest("hex");
}

export function assessmentFreshness(input: {
  assessment: BuyerRoleAssessment | null;
  buyerRole: string;
  fingerprint: string;
  sellerOffering: string;
  profile: Awaited<ReturnType<typeof getCanonicalCompanyProfile>>;
  exactCachedSemanticRole?: string | null;
}): "FRESH" | "CACHED_SEMANTIC_MATCH" | "STALE" {
  if (input.buyerRole === "UNKNOWN" || input.assessment?.buyerRole === "UNKNOWN") return "STALE";
  if (input.assessment?.controlPlaneVersion === COMPANY_INTELLIGENCE_CONTROL_PLANE_VERSION &&
    input.assessment.controlPlaneFingerprint === input.fingerprint &&
    input.assessment.buyerRole === input.buyerRole) return "FRESH";
  if (input.assessment && input.exactCachedSemanticRole === input.buyerRole) return "CACHED_SEMANTIC_MATCH";
  return "STALE";
}

/** Authoritative deterministic prerequisite control plane for company
 * intelligence. It decides which bounded capability runs; providers and the
 * semantic model do not decide workflow state transitions. */
export async function orchestrateCompanyIntelligence(input: {
  organizationId: string;
  projectId: string;
  companyId: string;
  router: Pick<ProviderOperations, "searchWeb" | "enrichCompany">;
  now?: Date;
}): Promise<CompanyIntelligenceControlResult> {
  const now = input.now ?? new Date();
  const seller = await resolveProjectSellerContext(input.projectId, input.organizationId);
  if (!seller.sufficiency.sufficient) {
    return result({
      status: "BLOCKED",
      reasonCode: "SELLER_CONTEXT_INSUFFICIENT",
      explanation: "Seller context and ICP prerequisites are incomplete.",
      missingRequirements: seller.missingRequirements,
      nextRecommendedCapability: null,
      retrySensible: true,
      manualReviewHelpful: true,
      minimumIntelligence: null,
      buyerRole: "UNKNOWN",
      who: null,
      semantic: null,
    });
  }
  const [initial] = await db.select({ membership: projectCompaniesTable, company: companiesTable })
    .from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(and(
      eq(projectCompaniesTable.projectId, input.projectId),
      eq(projectCompaniesTable.companyId, input.companyId),
    ))
    .limit(1);
  if (!initial) throw new Error("Company is not available in this project");
  const minimum = await ensureMinimumCompanyIntelligence(input);
  if (!minimum.identitySafe && minimum.identityPermissions.trustLevel === "UNSAFE") {
    const reason = minimum.identityPermissions.reasonCode as CompanyIntelligenceReasonCode;
    return result({
      status: "BLOCKED",
      reasonCode: reason,
      explanation: "Current identity evidence does not permit public profile research or semantic attribution.",
      missingRequirements: minimum.missingRequirements,
      nextRecommendedCapability: minimum.nextRecommendedCapability,
      retrySensible: reason === "DOMAIN_MISSING" || reason === "IDENTITY_EVIDENCE_INSUFFICIENT",
      manualReviewHelpful: true,
      minimumIntelligence: minimum,
      buyerRole: "UNKNOWN",
      who: null,
      semantic: null,
    });
  }
  if (minimum.stage !== "SUFFICIENT") {
    return result({
      status: "INSUFFICIENT",
      reasonCode: "COMPANY_PROFILE_MISSING",
      explanation: "Bounded profile resolution completed without enough grounded company evidence.",
      missingRequirements: minimum.missingRequirements,
      nextRecommendedCapability: minimum.nextRecommendedCapability,
      retrySensible: true,
      manualReviewHelpful: true,
      minimumIntelligence: minimum,
      buyerRole: "UNKNOWN",
      who: null,
      semantic: null,
    });
  }
  const [current] = await db.select({ membership: projectCompaniesTable, company: companiesTable })
    .from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(and(
      eq(projectCompaniesTable.projectId, input.projectId),
      eq(projectCompaniesTable.companyId, input.companyId),
    ))
    .limit(1);
  if (!current) throw new Error("Company disappeared during intelligence orchestration");
  const profile = await getCanonicalCompanyProfile(input.projectId, current.company);
  const provenance = await db.select().from(companyProvenanceTable)
    .where(and(
      eq(companyProvenanceTable.projectId, input.projectId),
      eq(companyProvenanceTable.companyId, input.companyId),
    ))
    .orderBy(desc(companyProvenanceTable.createdAt));
  const evidence = buildCandidateEvidence(profile, provenance);
  const semanticInputFingerprint = semanticFingerprint({
    projectId: input.projectId,
    companyId: input.companyId,
    sellerContextFingerprint: seller.context.fingerprint,
    canonicalName: profile.canonicalName,
    canonicalDomain: profile.domain,
    evidence,
  });
  const fingerprint = controlPlaneFingerprint({
    projectId: input.projectId,
    companyId: input.companyId,
    sellerContextFingerprint: seller.context.fingerprint,
    semanticInputFingerprint,
    profile,
  });
  const exactSemantic = provenance.find((row) =>
    row.sourceType === "FIX08_COMPANY_UNDERSTANDING" &&
    row.sourceLabel === COMPANY_UNDERSTANDING_MODEL &&
    row.payload.fingerprint === semanticInputFingerprint &&
    row.payload.promptVersion === COMPANY_UNDERSTANDING_PROMPT_VERSION &&
    row.payload.normalizationVersion === COMPANY_UNDERSTANDING_NORMALIZATION_VERSION);
  const exactCachedSemanticRole = exactSemantic?.payload.validatedOutput &&
    typeof exactSemantic.payload.validatedOutput === "object"
    ? String((exactSemantic.payload.validatedOutput as Record<string, unknown>).commercial_role ?? "")
    : null;
  const freshness = assessmentFreshness({
    assessment: current.membership.buyerRoleAssessment,
    buyerRole: current.membership.buyerRole,
    fingerprint,
    sellerOffering: seller.context.offeringName ?? "",
    profile,
    exactCachedSemanticRole,
  });
  const semantic = freshness === "STALE"
    ? await assessCompanySemantically({
        organizationId: input.organizationId,
        projectId: input.projectId,
        companyId: input.companyId,
        profile,
        identitySafe: minimum.identityPermissions.canRunCompanyUnderstanding,
      })
    : {
        assessment: current.membership.buyerRoleAssessment!,
        output: exactSemantic?.payload.validatedOutput as never ?? null,
        cacheHit: true,
        llmInvoked: false,
        unknownReason: null,
        usage: null,
      };
  const stampedAssessment: BuyerRoleAssessment = {
    ...semantic.assessment,
    controlPlaneFingerprint: fingerprint,
    controlPlaneVersion: COMPANY_INTELLIGENCE_CONTROL_PLANE_VERSION,
    whoResolution: resolveWhoFromCommercialRole(semantic.assessment) ?? undefined,
  };
  await db.update(projectCompaniesTable).set({
    buyerRole: stampedAssessment.buyerRole,
    buyerRoleAssessment: stampedAssessment,
    updatedAt: now,
  }).where(and(
    eq(projectCompaniesTable.id, current.membership.id),
    eq(projectCompaniesTable.projectId, input.projectId),
  ));
  const buyerRole = stampedAssessment.buyerRole;
  const semanticSummary = {
    cacheHit: semantic.cacheHit,
    llmInvoked: semantic.llmInvoked,
    unknownReason: semantic.unknownReason,
    reusedPersistedAssessment: freshness !== "STALE",
    output: semantic.output,
    usage: semantic.usage,
  };
  if (buyerRole === "UNKNOWN") {
    return result({
      status: "INSUFFICIENT",
      reasonCode: "COMMERCIAL_RELATIONSHIP_AMBIGUOUS",
      explanation: "Grounded evidence exists, but the seller-relative commercial relationship remains ambiguous.",
      missingRequirements: semantic.output?.missing_information ?? ["commercial relationship evidence"],
      nextRecommendedCapability: null,
      retrySensible: false,
      manualReviewHelpful: true,
      minimumIntelligence: minimum,
      buyerRole,
      who: null,
      semantic: semanticSummary,
    });
  }
  if (buyerRole !== "POTENTIAL_BUYER") {
    const reasonCode = buyerRole === "SELLER_COMPETITOR"
      ? "COMPETITOR_NOT_ELIGIBLE"
      : buyerRole === "ADJACENT_VENDOR"
        ? "ADJACENT_VENDOR_NOT_ELIGIBLE"
        : "PARTNER_NOT_ELIGIBLE";
    return result({
      status: "SUCCESS",
      reasonCode,
      explanation: `Company intelligence resolved the commercial role as ${buyerRole}; buyer research is not eligible.`,
      missingRequirements: [],
      nextRecommendedCapability: null,
      retrySensible: false,
      manualReviewHelpful: false,
      minimumIntelligence: minimum,
      buyerRole,
      who: stampedAssessment.whoResolution ? exclusionWhoResult(stampedAssessment.whoResolution) : null,
      semantic: semanticSummary,
    });
  }
  const who = await qualifyProjectCompanyForWho({ projectId: input.projectId, company: current.company, buyerRole });
  if (!who.eligible) {
    const missing = who.qualification === "INSUFFICIENT_DATA";
    const canResolveWithFirmographics = shouldRecommendCompanyFirmographics(who);
    return result({
      status: missing ? "PARTIAL" : "SUCCESS",
      reasonCode: missing ? "ICP_REQUIREMENTS_MISSING" : "ICP_NOT_FIT",
      explanation: missing
        ? "Commercial role is resolved, but WHO lacks required ICP evidence."
        : "Commercial role is resolved, but the company does not satisfy the current ICP.",
      missingRequirements: missing ? who.missingRequirements : [],
      nextRecommendedCapability: canResolveWithFirmographics ? "COMPANY_FIRMOGRAPHICS" : null,
      missingIcpDimensions: missing ? who.missingDimensions : [],
      missingIcpReasonCodes: missing ? who.missingReasonCodes : [],
      retrySensible: canResolveWithFirmographics,
      manualReviewHelpful: missing,
      minimumIntelligence: minimum,
      buyerRole,
      who,
      semantic: semanticSummary,
    });
  }
  return result({
    status: "SUCCESS",
    reasonCode: "READY_FOR_SIGNAL_RESEARCH",
    explanation: "Identity, minimum intelligence, commercial role, and WHO prerequisites are satisfied.",
    missingRequirements: [],
    nextRecommendedCapability: "SIGNAL_RESEARCH",
    retrySensible: false,
    manualReviewHelpful: false,
    minimumIntelligence: minimum,
    buyerRole,
    who,
    semantic: semanticSummary,
  });
}
