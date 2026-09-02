import { SAFETY_POLICY_VERSION, type CompanyIntelligenceProfileV2, type FinalAssessmentV2, type SellerRelativeAssessmentV2, type SafetyOverrideV2 } from "./schemas";

export function applySafetyRulesV2(input: {
  profile: CompanyIntelligenceProfileV2; assessment: SellerRelativeAssessmentV2; fingerprint: string;
}): FinalAssessmentV2 {
  const assessment = structuredClone(input.assessment);
  const overrides: SafetyOverrideV2[] = [];
  if (assessment.commercialRole.value === "SELLER_COMPETITOR") {
    assessment.who.value = "LIKELY_NOT_FIT";
    assessment.who.reason = "A seller competitor is excluded from actionable buyer targeting.";
    assessment.who.evidenceIds = assessment.commercialRole.evidenceIds;
    overrides.push("COMMERCIAL_ROLE_EXCLUSION");
  }
  const mandatoryFailure = assessment.who.criteria.some((criterion) =>
    criterion.mandatory && criterion.result === "FAIL" && criterion.evidenceIds.length);
  if (mandatoryFailure && assessment.who.value === "LIKELY_FIT") {
    assessment.who.value = "LIKELY_NOT_FIT";
    overrides.push("MANDATORY_CRITERION_FAILURE");
  }
  if (input.profile.identity.status === "IDENTITY_UNCERTAIN") {
    assessment.commercialRole.value = "UNKNOWN";
    assessment.who.value = "INSUFFICIENT_DATA";
    overrides.push("IDENTITY_UNCERTAIN");
  }
  const unsupportedMandatoryPositive = assessment.who.criteria.some((criterion) =>
    criterion.mandatory && criterion.result === "PASS" && !criterion.evidenceIds.length);
  if (unsupportedMandatoryPositive && ["LIKELY_FIT", "POSSIBLE_FIT"].includes(assessment.who.value)) {
    assessment.who.value = "INSUFFICIENT_DATA";
    overrides.push("EVIDENCELESS_POSITIVE_BLOCKED");
  }
  return {
    ...assessment,
    resolutionType: overrides[0] ?? "SEMANTIC_ASSESSMENT",
    deterministicOverrides: overrides,
    fingerprint: input.fingerprint,
  };
}

export { SAFETY_POLICY_VERSION };