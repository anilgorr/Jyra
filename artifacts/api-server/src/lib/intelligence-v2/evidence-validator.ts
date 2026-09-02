import { assessmentSchema, researchRequirementSchema, type EvidenceItemV2, type SellerRelativeAssessmentV2, type SellerRelativeContextV2 } from "./schemas";

export type EvidenceValidationResult =
  | { ok: true; assessment: SellerRelativeAssessmentV2 }
  | { ok: false; errors: string[] };

const ROLE_TYPES = {
  SUPPORTS_ROLE: ["PRIMARY_BUSINESS", "PRODUCT_SERVICE", "OFFERING_OVERLAP"],
  MATERIAL_SUBSTITUTE: ["OFFERING_OVERLAP"],
  COMPLEMENTARY: ["PRIMARY_BUSINESS", "PRODUCT_SERVICE", "OFFERING_OVERLAP"],
  BUYER_CAPABILITY: ["PRIMARY_BUSINESS", "PRODUCT_SERVICE", "BUSINESS_MODEL", "INDUSTRY", "TECHNOLOGY"],
} as const;
const WHO_TYPES = ["ICP_CRITERION", "GEOGRAPHY", "BUSINESS_MODEL", "INDUSTRY", "EMPLOYEE_SIZE", "TECHNOLOGY", "PRIMARY_BUSINESS", "PRODUCT_SERVICE", "OFFERING_OVERLAP"] as const;

export function validateAssessmentEvidenceV2(value: unknown, evidence: EvidenceItemV2[], context?: Pick<SellerRelativeContextV2, "icp">): EvidenceValidationResult {
  const parsed = assessmentSchema.safeParse(value);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  const errors: string[] = [];
  const known = new Set<string>();
  const claims = new Map<string, EvidenceItemV2["atomicClaims"][number] & { evidenceId: string }>();
  for (const item of evidence) {
    if (known.has(item.evidenceId)) errors.push(`duplicate evidenceId: ${item.evidenceId}`);
    known.add(item.evidenceId);
    for (const claim of item.atomicClaims) {
      if (claims.has(claim.claimId)) errors.push(`duplicate claimId: ${claim.claimId}`);
      else claims.set(claim.claimId, { ...claim, evidenceId: item.evidenceId });
    }
  }
  const duplicate = (path: string, values: string[]) => {
    if (new Set(values).size !== values.length) errors.push(`${path} contains duplicate IDs`);
  };
  const bindingsValid = (path: string, bindings: Array<{ claimId: string; claimedValue: string; purpose: string; relation: string }>, sectionClaimIds: string[], sectionEvidenceIds: string[], allowed: readonly string[]) => {
    duplicate(`${path}.bindings`, bindings.map((binding) => binding.claimId));
    for (const binding of bindings) {
      const claim = claims.get(binding.claimId);
      if (!claim) { errors.push(`${path} binding cites unknown claim`); continue; }
      if (!sectionClaimIds.includes(binding.claimId)) errors.push(`${path} binding absent from section claimIds`);
      if (!sectionEvidenceIds.includes(claim.evidenceId)) errors.push(`${path} binding parent evidence absent from section evidenceIds`);
      if (claim.value !== binding.claimedValue) errors.push(`${path} binding value does not match claim`);
      if (!allowed.includes(binding.relation)) errors.push(`${path} has invalid binding relation`);
      if (path === "commercialRole" && claim && !(ROLE_TYPES[binding.relation as keyof typeof ROLE_TYPES] as readonly string[] | undefined)?.includes(claim.type)) errors.push(`${path} relation/type mismatch`);
      if (path !== "commercialRole" && claim && !WHO_TYPES.includes(claim.type as typeof WHO_TYPES[number])) errors.push(`${path} relation/type mismatch`);
      if (path.includes("criteria") && binding.relation === "SATISFIES_CRITERION" && !path.endsWith("unknown") && !binding.purpose) errors.push(`${path} invalid criterion purpose`);
    }
  };
  const check = (path: string, ids: string[], claimIds: string[], factual = true, accepted?: readonly string[]) => {
    duplicate(`${path}.evidenceIds`, ids);
    duplicate(`${path}.claimIds`, claimIds);
    if (ids.some((id) => !known.has(id))) errors.push(`${path} cites unknown evidence`);
    if (claimIds.some((id) => !claims.has(id))) errors.push(`${path} cites unknown claim`);
    if (claimIds.some((id) => !ids.includes(claims.get(id)!.evidenceId))) errors.push(`${path} claim is not linked to cited evidence`);
    if (accepted && claimIds.some((id) => !accepted.includes(claims.get(id)!.type))) errors.push(`${path} uses unsupported claim type`);
    if (factual && !ids.length) errors.push(`${path} has no evidence`);
    if (factual && !claimIds.length) errors.push(`${path} has no atomic claim`);
  };
  check("commercialRole", parsed.data.commercialRole.evidenceIds, parsed.data.commercialRole.claimIds, parsed.data.commercialRole.value !== "UNKNOWN", ["PRIMARY_BUSINESS", "PRODUCT_SERVICE", "OFFERING_OVERLAP", "BUSINESS_MODEL", "INDUSTRY", "TECHNOLOGY"]);
  check("who", parsed.data.who.evidenceIds, parsed.data.who.claimIds, parsed.data.who.value !== "INSUFFICIENT_DATA");
  bindingsValid("commercialRole", parsed.data.commercialRole.claimBindings, parsed.data.commercialRole.claimIds, parsed.data.commercialRole.evidenceIds, ["SUPPORTS_ROLE", "MATERIAL_SUBSTITUTE", "COMPLEMENTARY", "BUYER_CAPABILITY"]);
  bindingsValid("who", parsed.data.who.claimBindings, parsed.data.who.claimIds, parsed.data.who.evidenceIds, ["SUPPORTS_WHO", "SATISFIES_CRITERION", "FAILS_CRITERION"]);
  if (parsed.data.commercialRole.value !== "UNKNOWN" && !parsed.data.commercialRole.claimBindings.length) errors.push("commercialRole has no compatible binding");
  if (parsed.data.who.value !== "INSUFFICIENT_DATA" && !parsed.data.who.claimBindings.length) errors.push("who has no compatible binding");
  if (parsed.data.commercialRole.value === "SELLER_COMPETITOR" && !parsed.data.commercialRole.claimBindings.some((binding) => binding.relation === "MATERIAL_SUBSTITUTE" && claims.get(binding.claimId)?.type === "OFFERING_OVERLAP")) errors.push("competitor lacks material-substitutability overlap binding");
  const requirements = context && Array.isArray(context.icp.requirements)
    ? context.icp.requirements.map((item) => researchRequirementSchema.safeParse(item)).filter((item) => item.success).map((item) => item.data)
    : null;
  if (requirements) {
    const expected = new Map(requirements.map((requirement) => [requirement.criterionId, requirement]));
    if (parsed.data.who.criteria.length !== expected.size) errors.push("who criteria do not match supplied ICP");
    for (const criterion of parsed.data.who.criteria) {
      const requirement = expected.get(criterion.criterionId);
      const expectedDescription = requirement && `${requirement.type} ${requirement.operator}${requirement.value ? ` ${requirement.value}` : ""}`;
      if (!requirement || criterion.mandatory !== requirement.mandatory || criterion.description !== expectedDescription) errors.push(`criterion ${criterion.criterionId} does not match supplied ICP`);
      expected.delete(criterion.criterionId);
    }
    if (expected.size) errors.push("who is missing supplied ICP criteria");
  }
  parsed.data.who.criteria.forEach((criterion, index) =>
    { check(`who.criteria.${index}`, criterion.evidenceIds, criterion.claimIds, criterion.result !== "UNKNOWN", ["ICP_CRITERION", "GEOGRAPHY", "BUSINESS_MODEL", "INDUSTRY", "EMPLOYEE_SIZE", "TECHNOLOGY", "PRIMARY_BUSINESS", "PRODUCT_SERVICE"]);
      bindingsValid(`who.criteria.${index}`, criterion.claimBindings, criterion.claimIds, criterion.evidenceIds, ["SATISFIES_CRITERION", "FAILS_CRITERION"]);
      if (!criterion.claimBindings.every((binding) => binding.purpose === criterion.criterionId)) errors.push(`who.criteria.${index} binding purpose invalid`);
      if (criterion.result === "PASS" && (!criterion.claimBindings.length || criterion.claimBindings.some((binding) => binding.relation !== "SATISFIES_CRITERION"))) errors.push(`who.criteria.${index} PASS lacks compatible citations`);
      if (criterion.result === "FAIL" && (!criterion.claimBindings.length || criterion.claimBindings.some((binding) => binding.relation !== "FAILS_CRITERION"))) errors.push(`who.criteria.${index} FAIL lacks compatible citations`);
      if (criterion.result === "UNKNOWN" && (criterion.evidenceIds.length || criterion.claimIds.length || criterion.claimBindings.length)) errors.push(`who.criteria.${index} UNKNOWN must be an evidence-free abstention`);
      const requirement = requirements?.find((item) => item.criterionId === criterion.criterionId);
      if (requirement && criterion.result !== "UNKNOWN") for (const binding of criterion.claimBindings) {
        const claim = claims.get(binding.claimId);
        if (!claim || (claim.type !== requirement.type && claim.type !== "ICP_CRITERION")) {
          errors.push(`who.criteria.${index} claim type does not match criterion`);
          continue;
        }
        const actual = claim.value.toLocaleLowerCase();
        const expected = requirement.value?.toLocaleLowerCase();
        const positive = requirement.operator === "EXISTS"
          ? true
          : requirement.operator === "EQUALS" ? actual === expected
          : requirement.operator === "CONTAINS" ? Boolean(expected && actual.includes(expected))
          : requirement.operator === "NOT_CONTAINS" ? Boolean(expected && !actual.includes(expected))
          : actual === expected;
        const compatible = criterion.result === "PASS"
          ? positive && requirement.operator !== "NOT_CONTAINS"
          : !positive || (requirement.operator === "NOT_CONTAINS" && Boolean(expected && actual.includes(expected)));
        if (!compatible) errors.push(`who.criteria.${index} claim value/relation does not match criterion result`);
      }
    });
  return errors.length ? { ok: false, errors } : { ok: true, assessment: parsed.data };
}