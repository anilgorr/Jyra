import { z } from "zod/v4";

export const INTELLIGENCE_CORE_VERSION = "JYRA_INTELLIGENCE_V2" as const;
export const COMPANY_PROFILE_VERSION = "company-intelligence-profile-v2" as const;
export const ASSESSMENT_POLICY_VERSION = "seller-relative-assessment-v2" as const;
export const ASSESSMENT_PROMPT_VERSION = "seller-relative-who-role-v2" as const;
export const SAFETY_POLICY_VERSION = "market-fit-safety-v2" as const;
export const ASSESSMENT_MODEL = "gpt-5-mini" as const;
export const MAX_EXTERNAL_RESEARCH_CALLS = 6;

const confidence = z.number().finite().min(0).max(1);
const evidenceIds = z.array(z.string().min(1)).max(30);
export const identityStatuses = ["RESOLVED", "IDENTITY_UNCERTAIN"] as const;
export const commercialRoles = ["POTENTIAL_BUYER", "SELLER_COMPETITOR", "ADJACENT_VENDOR", "PARTNER_POSSIBLE", "UNKNOWN"] as const;
export const whoValues = ["LIKELY_FIT", "POSSIBLE_FIT", "LIKELY_NOT_FIT", "INSUFFICIENT_DATA"] as const;
export const geographySemantics = ["HEADQUARTERS", "PRIMARY_OPERATING_GEOGRAPHY", "OFFICE_PRESENCE", "CUSTOMER_MARKET", "TALENT_MARKET", "REGISTERED_ADDRESS", "GLOBAL_AVAILABILITY"] as const;
export const claimTypes = ["BRAND_MATCH", "PRIMARY_BUSINESS", "PRODUCT_SERVICE", "BUSINESS_MODEL", "INDUSTRY", "GEOGRAPHY", "EMPLOYEE_SIZE", "TECHNOLOGY", "OFFERING_OVERLAP", "ICP_CRITERION"] as const;
export const researchRequirementSchema = z.object({
  criterionId: z.string().min(1), type: z.enum(claimTypes), operator: z.enum(["EQUALS", "CONTAINS", "RANGE", "EXISTS", "NOT_CONTAINS"]),
  value: z.string().min(1).optional(), mandatory: z.boolean(), exclusion: z.boolean(), preferred: z.boolean(),
}).strict();
export type ResearchRequirementV2 = z.infer<typeof researchRequirementSchema>;

export const evidenceItemSchema = z.object({
  evidenceId: z.string().min(1),
  organizationId: z.string().min(1),
  companyId: z.string().min(1),
  projectId: z.string().min(1),
  sourceType: z.string().min(1),
  provider: z.string().min(1),
  url: z.string().url().nullable(),
  finalUrl: z.string().url().nullable(),
  title: z.string().min(1).max(500),
  observedAt: z.string().datetime(),
  rawSnippet: z.string().min(1).max(4000),
  firstParty: z.boolean(),
  confidence,
  version: z.string().min(1),
  atomicClaims: z.array(z.object({
    claimId: z.string().min(1), type: z.enum(claimTypes), value: z.string().min(1),
    geographyType: z.enum(geographySemantics).optional(),
  }).strict()).max(40),
  claims: z.object({
    primaryBusiness: z.string().min(1).optional(),
    productsServices: z.array(z.string().min(1)).max(20).optional(),
    businessModel: z.string().min(1).optional(),
    industry: z.string().min(1).optional(),
    geography: z.array(z.object({ type: z.enum(geographySemantics), value: z.string().min(1) }).strict()).max(20).optional(),
    employeeSize: z.string().min(1).optional(),
    technologyFacts: z.array(z.object({ type: z.string().min(1), value: z.string().min(1) }).strict()).max(20).optional(),
    offeringOverlapFacts: z.array(z.string().min(1)).max(20).optional(),
  }).strict().optional(),
}).strict();
export type EvidenceItemV2 = z.infer<typeof evidenceItemSchema>;

const factSchema = z.object({
  value: z.string().min(1),
  confidence,
  evidenceIds,
}).strict();
export type ProfileFactV2 = z.infer<typeof factSchema>;

export const geographyFactSchema = factSchema.extend({
  type: z.enum(geographySemantics),
}).strict();
export type GeographyFactV2 = z.infer<typeof geographyFactSchema>;

export const identityResolutionSchema = z.object({
  status: z.enum(identityStatuses),
  confidence,
  reason: z.string().min(1).max(1000),
  evidenceIds,
  normalizedCompanyName: z.string().min(1),
  normalizedDomain: z.string().nullable(),
  normalizedUrl: z.string().url().nullable(),
}).strict();
export type IdentityResolutionV2 = z.infer<typeof identityResolutionSchema>;

export const companyProfileSchema = z.object({
  version: z.literal(COMPANY_PROFILE_VERSION),
  companyId: z.string().min(1),
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  companyName: z.string().min(1),
  domain: z.string().nullable(),
  identity: identityResolutionSchema.pick({ status: true, confidence: true, reason: true, evidenceIds: true }),
  primaryBusiness: factSchema.nullable(),
  productsServices: z.array(factSchema).max(20),
  businessModel: factSchema.nullable(),
  industry: factSchema.nullable(),
  geography: z.object({
    headquarters: geographyFactSchema.nullable(),
    primaryOperatingGeography: geographyFactSchema.nullable(),
    offices: z.array(geographyFactSchema).max(20),
    otherPresence: z.array(geographyFactSchema).max(30),
    confidence,
    evidenceIds,
  }).strict(),
  employeeSize: factSchema.nullable(),
  technologyFacts: z.array(factSchema.extend({ type: z.string().min(1) }).strict()).max(30),
  offeringOverlapFacts: z.array(factSchema).max(20),
  unknownFields: z.array(z.string().min(1)).max(30),
  profileConfidence: confidence,
  createdAt: z.string().datetime(),
  fingerprint: z.string().min(1),
}).strict();
export type CompanyIntelligenceProfileV2 = z.infer<typeof companyProfileSchema>;

export const assessmentSchema = z.object({
  commercialRole: z.object({
    value: z.enum(commercialRoles), confidence, reason: z.string().min(1).max(1200), evidenceIds, claimIds: z.array(z.string().min(1)).max(40),
    claimBindings: z.array(z.object({ claimId: z.string().min(1), claimedValue: z.string().min(1), purpose: z.string().min(1), relation: z.enum(["SUPPORTS_ROLE", "MATERIAL_SUBSTITUTE", "COMPLEMENTARY", "BUYER_CAPABILITY"]) }).strict()).max(40),
  }).strict(),
  who: z.object({
    value: z.enum(whoValues), confidence, reason: z.string().min(1).max(1200), evidenceIds, claimIds: z.array(z.string().min(1)).max(40),
    claimBindings: z.array(z.object({ claimId: z.string().min(1), claimedValue: z.string().min(1), purpose: z.string().min(1), relation: z.enum(["SUPPORTS_WHO", "SATISFIES_CRITERION", "FAILS_CRITERION"]) }).strict()).max(40),
    criteria: z.array(z.object({
      criterionId: z.string().min(1), description: z.string().min(1), mandatory: z.boolean(),
      result: z.enum(["PASS", "FAIL", "UNKNOWN"]), confidence: confidence.optional(), reason: z.string().min(1).max(800), evidenceIds, claimIds: z.array(z.string().min(1)).max(40),
      claimBindings: z.array(z.object({ claimId: z.string().min(1), claimedValue: z.string().min(1), purpose: z.string().min(1), relation: z.enum(["SATISFIES_CRITERION", "FAILS_CRITERION"]) }).strict()).max(40),
    }).strict()).max(40),
  }).strict(),
  uncertainties: z.array(z.string().min(1)).max(30),
  assessmentConfidence: confidence,
}).strict();
export type SellerRelativeAssessmentV2 = z.infer<typeof assessmentSchema>;

export type SellerRelativeContextV2 = {
  organizationId: string;
  projectId: string;
  businessTwinVersion: string;
  offeringVersion: string;
  icpVersion: string;
  sellerBusinessTwin: Record<string, unknown>;
  offering: Record<string, unknown>;
  icp: Record<string, unknown>;
};
export const sellerRelativeContextSchema = z.object({
  organizationId: z.string().min(1), projectId: z.string().min(1), businessTwinVersion: z.string().min(1),
  offeringVersion: z.string().min(1), icpVersion: z.string().min(1),
  sellerBusinessTwin: z.record(z.string(), z.unknown()), offering: z.record(z.string(), z.unknown()), icp: z.record(z.string(), z.unknown()),
}).strict();

export type ResearchActionV2 = {
  source: "CACHE" | "FIRST_PARTY" | "COMPANY_PROFILE" | "WEB_SEARCH" | "FALLBACK";
  capability: "WEBSITE_CRAWL" | "COMPANY_PROFILE_RESOLUTION" | "COMPANY_LOOKUP" | "COMPANY_FIRMOGRAPHICS" | "WEB_SEARCH";
  external: boolean;
  status: "USED" | "EMPTY" | "FAILED" | "SKIPPED";
  provider: string;
  cost: number;
};

export type ResearchPackageV2 = {
  organizationId: string;
  projectId: string;
  companyId: string;
  evidence: EvidenceItemV2[];
  negativeAssertions: Array<{
    requirementId: string; absentValue: string; providerId: string; providerRequestId: string;
    capability: ResearchActionV2["capability"]; sourceEvidenceIds: string[]; capturedAt: string; exhaustive: true;
  }>;
  actions: ResearchActionV2[];
  externalCalls: number;
  providerCost: number;
  sufficient: boolean;
  fingerprint: string;
};

export type SafetyOverrideV2 =
  | "COMMERCIAL_ROLE_EXCLUSION"
  | "MANDATORY_CRITERION_FAILURE"
  | "IDENTITY_UNCERTAIN"
  | "EVIDENCELESS_POSITIVE_BLOCKED";

export type SafetyOverrideMetadataV2 = {
  rule: SafetyOverrideV2;
  changed: Array<"commercialRole" | "who">;
  provenance: "PRESERVED" | "EVIDENCE_FREE_ABSTENTION";
};

export type FinalAssessmentV2 = SellerRelativeAssessmentV2 & {
  resolutionType: "SEMANTIC_ASSESSMENT" | SafetyOverrideV2;
  deterministicOverrides: SafetyOverrideV2[];
  safetyOverrideMetadata: SafetyOverrideMetadataV2[];
  fingerprint: string;
};