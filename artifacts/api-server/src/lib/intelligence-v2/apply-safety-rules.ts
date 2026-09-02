import { SAFETY_POLICY_VERSION, type CompanyIntelligenceProfileV2, type FinalAssessmentV2, type SafetyOverrideMetadataV2, type SellerRelativeAssessmentV2, type SafetyOverrideV2 } from "./schemas";

export function applySafetyRulesV2(input: {
  profile: CompanyIntelligenceProfileV2; assessment: SellerRelativeAssessmentV2; fingerprint: string;
}): FinalAssessmentV2 {
  const assessment = structuredClone(input.assessment);
  const overrides: SafetyOverrideV2[] = [];
  const metadata: SafetyOverrideMetadataV2[] = [];
  if (assessment.commercialRole.value === "SELLER_COMPETITOR") {
    assessment.who.value = "LIKELY_NOT_FIT";
    assessment.who.reason = "The cited material substitute is excluded from actionable buyer targeting.";
    assessment.who.evidenceIds = [...assessment.commercialRole.evidenceIds];
    assessment.who.claimIds = [...assessment.commercialRole.claimIds];
    assessment.who.claimBindings = assessment.commercialRole.claimBindings.map((binding) => ({
      claimId: binding.claimId, claimedValue: binding.claimedValue, purpose: "WHO", relation: "SUPPORTS_WHO" as const,
    }));
    overrides.push("COMMERCIAL_ROLE_EXCLUSION");
    metadata.push({ rule: "COMMERCIAL_ROLE_EXCLUSION", changed: ["who"], provenance: "PRESERVED" });
  }
  const mandatoryFailures = assessment.who.criteria.filter((criterion) =>
    criterion.mandatory && criterion.result === "FAIL" && criterion.evidenceIds.length && criterion.claimBindings.length);
  const mandatoryFailure = mandatoryFailures.length > 0;
  if (mandatoryFailure && assessment.who.value === "LIKELY_FIT") {
    assessment.who.value = "LIKELY_NOT_FIT";
    assessment.who.reason = "A cited mandatory ICP criterion failed.";
    assessment.who.evidenceIds = [...new Set(mandatoryFailures.flatMap((criterion) => criterion.evidenceIds))];
    assessment.who.claimIds = [...new Set(mandatoryFailures.flatMap((criterion) => criterion.claimIds))];
    assessment.who.claimBindings = mandatoryFailures.flatMap((criterion) => criterion.claimBindings);
    overrides.push("MANDATORY_CRITERION_FAILURE");
    metadata.push({ rule: "MANDATORY_CRITERION_FAILURE", changed: ["who"], provenance: "PRESERVED" });
  }
  if (input.profile.identity.status === "IDENTITY_UNCERTAIN") {
    assessment.commercialRole.value = "UNKNOWN";
    assessment.commercialRole.reason = "Commercial role is unknown because company identity is uncertain.";
    assessment.commercialRole.evidenceIds = [];
    assessment.commercialRole.claimIds = [];
    assessment.commercialRole.claimBindings = [];
    assessment.who.value = "INSUFFICIENT_DATA";
    assessment.who.reason = "Structural fit is not assessed because company identity is uncertain.";
    assessment.who.evidenceIds = [];
    assessment.who.claimIds = [];
    assessment.who.claimBindings = [];
    overrides.push("IDENTITY_UNCERTAIN");
    metadata.push({ rule: "IDENTITY_UNCERTAIN", changed: ["commercialRole", "who"], provenance: "EVIDENCE_FREE_ABSTENTION" });
  }
  const unsupportedMandatoryPositive = assessment.who.criteria.some((criterion) =>
    criterion.mandatory && criterion.result === "PASS" && (!criterion.evidenceIds.length || !criterion.claimBindings.length));
  if (unsupportedMandatoryPositive && ["LIKELY_FIT", "POSSIBLE_FIT"].includes(assessment.who.value)) {
    assessment.who.value = "INSUFFICIENT_DATA";
    assessment.who.reason = "Structural fit abstains because a mandatory positive criterion has no evidence.";
    assessment.who.evidenceIds = [];
    assessment.who.claimIds = [];
    assessment.who.claimBindings = [];
    assessment.who.criteria = assessment.who.criteria.map((criterion) => criterion.mandatory && criterion.result === "PASS" && (!criterion.evidenceIds.length || !criterion.claimBindings.length)
      ? { ...criterion, result: "UNKNOWN" as const, reason: "This mandatory criterion lacks evidence.", evidenceIds: [], claimIds: [], claimBindings: [] }
      : criterion);
    overrides.push("EVIDENCELESS_POSITIVE_BLOCKED");
    metadata.push({ rule: "EVIDENCELESS_POSITIVE_BLOCKED", changed: ["who"], provenance: "EVIDENCE_FREE_ABSTENTION" });
  }
  return {
    ...assessment,
    resolutionType: overrides[0] ?? "SEMANTIC_ASSESSMENT",
    deterministicOverrides: overrides,
    safetyOverrideMetadata: metadata,
    fingerprint: input.fingerprint,
  };
}

export { SAFETY_POLICY_VERSION };