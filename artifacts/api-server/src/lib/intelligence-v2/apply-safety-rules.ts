import { SAFETY_POLICY_VERSION, researchRequirementSchema, type CompanyIntelligenceProfileV2, type FinalAssessmentV2, type SafetyOverrideMetadataV2, type SellerRelativeAssessmentV2, type SafetyOverrideV2, type SellerRelativeContextV2 } from "./schemas";

const POSITIVE_WHO = new Set<SellerRelativeAssessmentV2["who"]["value"]>(["LIKELY_FIT", "POSSIBLE_FIT"]);

export function applySafetyRulesV2(input: {
  profile: CompanyIntelligenceProfileV2; assessment: SellerRelativeAssessmentV2; fingerprint: string;
  /** Optional ICP context so exclusion criteria are recognised even for cached assessments that predate the `exclusion` flag. */
  context?: Pick<SellerRelativeContextV2, "icp">;
}): FinalAssessmentV2 {
  const assessment = structuredClone(input.assessment);
  const overrides: SafetyOverrideV2[] = [];
  const metadata: SafetyOverrideMetadataV2[] = [];
  const requirements = new Map((Array.isArray(input.context?.icp.requirements) ? input.context.icp.requirements : [])
    .map((item) => researchRequirementSchema.safeParse(item)).filter((item) => item.success).map((item) => [item.data.criterionId, item.data]));
  const isExclusion = (criterion: SellerRelativeAssessmentV2["who"]["criteria"][number]) =>
    criterion.exclusion ?? requirements.get(criterion.criterionId)?.exclusion ?? false;
  const cited = (criterion: SellerRelativeAssessmentV2["who"]["criteria"][number]) => criterion.evidenceIds.length > 0 && criterion.claimBindings.length > 0;
  const uniqueBindings = <T extends { claimId: string }>(bindings: T[]) => [...new Map(bindings.map((binding) => [binding.claimId, binding])).values()];
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
  // Exclusion criteria: PASS means the company EXHIBITS the excluded characteristic.
  const exclusionMatches = assessment.who.criteria.filter((criterion) => isExclusion(criterion) && criterion.result === "PASS" && cited(criterion));
  if (exclusionMatches.length && assessment.who.value !== "LIKELY_NOT_FIT") {
    assessment.who.value = "LIKELY_NOT_FIT";
    assessment.who.reason = "A cited ICP exclusion criterion matched: the company exhibits an excluded characteristic.";
    assessment.who.evidenceIds = [...new Set(exclusionMatches.flatMap((criterion) => criterion.evidenceIds))];
    assessment.who.claimIds = [...new Set(exclusionMatches.flatMap((criterion) => criterion.claimIds))];
    assessment.who.claimBindings = uniqueBindings(exclusionMatches.flatMap((criterion) => criterion.claimBindings.map((binding) => ({
      claimId: binding.claimId, claimedValue: binding.claimedValue, purpose: "WHO", relation: "SUPPORTS_WHO" as const,
    }))));
    overrides.push("EXCLUSION_MATCH");
    metadata.push({ rule: "EXCLUSION_MATCH", changed: ["who"], provenance: "PRESERVED" });
  }
  const mandatoryFailures = assessment.who.criteria.filter((criterion) =>
    criterion.mandatory && !isExclusion(criterion) && criterion.result === "FAIL" && cited(criterion));
  if (mandatoryFailures.length > 0 && POSITIVE_WHO.has(assessment.who.value)) {
    assessment.who.value = "LIKELY_NOT_FIT";
    assessment.who.reason = "A cited mandatory ICP criterion failed.";
    assessment.who.evidenceIds = [...new Set(mandatoryFailures.flatMap((criterion) => criterion.evidenceIds))];
    assessment.who.claimIds = [...new Set(mandatoryFailures.flatMap((criterion) => criterion.claimIds))];
    assessment.who.claimBindings = uniqueBindings(mandatoryFailures.flatMap((criterion) => criterion.claimBindings));
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