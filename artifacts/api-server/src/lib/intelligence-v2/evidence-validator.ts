import { assessmentSchema, type EvidenceItemV2, type SellerRelativeAssessmentV2 } from "./schemas";

export type EvidenceValidationResult =
  | { ok: true; assessment: SellerRelativeAssessmentV2 }
  | { ok: false; errors: string[] };

export function validateAssessmentEvidenceV2(value: unknown, evidence: EvidenceItemV2[]): EvidenceValidationResult {
  const parsed = assessmentSchema.safeParse(value);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  const known = new Set(evidence.map((item) => item.evidenceId));
  const claims = new Map(evidence.flatMap((item) => item.atomicClaims.map((claim) => [claim.claimId, { ...claim, evidenceId: item.evidenceId }] as const)));
  const errors: string[] = [];
  const bindingsValid = (path: string, bindings: Array<{ claimId: string; claimedValue: string; purpose: string; relation: string }>, sectionClaimIds: string[], sectionEvidenceIds: string[], allowed: readonly string[]) => {
    for (const binding of bindings) {
      const claim = claims.get(binding.claimId);
      if (!claim) { errors.push(`${path} binding cites unknown claim`); continue; }
      if (!sectionClaimIds.includes(binding.claimId)) errors.push(`${path} binding absent from section claimIds`);
      if (!sectionEvidenceIds.includes(claim.evidenceId)) errors.push(`${path} binding parent evidence absent from section evidenceIds`);
      if (claim.value !== binding.claimedValue) errors.push(`${path} binding value does not match claim`);
      if (!allowed.includes(binding.relation)) errors.push(`${path} has invalid binding relation`);
    }
  };
  const check = (path: string, ids: string[], claimIds: string[], factual = true, accepted?: readonly string[]) => {
    if (ids.some((id) => !known.has(id))) errors.push(`${path} cites unknown evidence`);
    if (claimIds.some((id) => !claims.has(id))) errors.push(`${path} cites unknown claim`);
    if (claimIds.some((id) => !ids.includes(claims.get(id)!.evidenceId))) errors.push(`${path} claim is not linked to cited evidence`);
    if (accepted && claimIds.some((id) => !accepted.includes(claims.get(id)!.type))) errors.push(`${path} uses unsupported claim type`);
    if (factual && !ids.length) errors.push(`${path} has no evidence`);
    if (factual && !claimIds.length) errors.push(`${path} has no atomic claim`);
  };
  check("commercialRole", parsed.data.commercialRole.evidenceIds, parsed.data.commercialRole.claimIds, parsed.data.commercialRole.value !== "UNKNOWN", ["PRIMARY_BUSINESS", "PRODUCT_SERVICE", "OFFERING_OVERLAP"]);
  check("who", parsed.data.who.evidenceIds, parsed.data.who.claimIds, parsed.data.who.value !== "INSUFFICIENT_DATA");
  bindingsValid("commercialRole", parsed.data.commercialRole.claimBindings, parsed.data.commercialRole.claimIds, parsed.data.commercialRole.evidenceIds, ["SUPPORTS_ROLE", "MATERIAL_SUBSTITUTE", "COMPLEMENTARY", "BUYER_CAPABILITY"]);
  bindingsValid("who", parsed.data.who.claimBindings, parsed.data.who.claimIds, parsed.data.who.evidenceIds, ["SUPPORTS_WHO", "SATISFIES_CRITERION", "FAILS_CRITERION"]);
  if (parsed.data.commercialRole.value === "SELLER_COMPETITOR" && !parsed.data.commercialRole.claimBindings.some((binding) => binding.relation === "MATERIAL_SUBSTITUTE" && claims.get(binding.claimId)?.type === "OFFERING_OVERLAP")) errors.push("competitor lacks material-substitutability overlap binding");
  if (!parsed.data.commercialRole.claimBindings.every((binding) => parsed.data.commercialRole.reason.includes(binding.claimId))) errors.push("commercialRole reason must reference bound claims");
  if (!parsed.data.who.claimBindings.every((binding) => parsed.data.who.reason.includes(binding.claimId))) errors.push("who reason must reference bound claims");
  parsed.data.who.criteria.forEach((criterion, index) =>
    { check(`who.criteria.${index}`, criterion.evidenceIds, criterion.claimIds, criterion.result !== "UNKNOWN", ["ICP_CRITERION", "GEOGRAPHY", "BUSINESS_MODEL", "INDUSTRY", "EMPLOYEE_SIZE", "TECHNOLOGY", "PRIMARY_BUSINESS", "PRODUCT_SERVICE"]);
      bindingsValid(`who.criteria.${index}`, criterion.claimBindings, criterion.claimIds, criterion.evidenceIds, ["SATISFIES_CRITERION", "FAILS_CRITERION"]);
      if (!criterion.claimBindings.every((binding) => binding.purpose === criterion.criterionId && criterion.reason.includes(binding.claimId))) errors.push(`who.criteria.${index} binding/reason invalid`);
    });
  return errors.length ? { ok: false, errors } : { ok: true, assessment: parsed.data };
}