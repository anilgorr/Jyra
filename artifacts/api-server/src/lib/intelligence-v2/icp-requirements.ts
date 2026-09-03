import { claimTypes, researchRequirementSchema, type EvidenceItemV2, type ResearchRequirementV2, type RequirementValueV2 } from "./schemas";

/**
 * Shared ICP criterion → V2 research requirement mapping plus the single
 * deterministic evaluator used by research sufficiency, evidence validation
 * and safety rules. Both call sites (route + market-readiness adapter) must
 * use this so criteria are never mangled into JSON substrings.
 */

type ClaimTypeV2 = (typeof claimTypes)[number];
type AtomicClaimV2 = EvidenceItemV2["atomicClaims"][number];

export type IcpCriterionLikeV2 = {
  id: string;
  dimension: string;
  operator: string;
  value: unknown;
  criterionType: string;
  description?: string | null;
};

const DIMENSION_CLAIM_TYPES: Array<[RegExp, ClaimTypeV2]> = [
  [/GEOGRAPH|COUNTRY|REGION|LOCATION/, "GEOGRAPHY"],
  [/EMPLOYEE|HEADCOUNT|COMPANY_SIZE|\bSIZE\b/, "EMPLOYEE_SIZE"],
  [/TECH/, "TECHNOLOGY"],
  [/INDUSTR|SECTOR|VERTICAL/, "INDUSTRY"],
  [/BUSINESS_MODEL/, "BUSINESS_MODEL"],
];
/** Claim types a wildcard (`ICP_CRITERION`) requirement may bind. */
export const WILDCARD_CRITERION_CLAIM_TYPES: readonly ClaimTypeV2[] = ["PRIMARY_BUSINESS", "PRODUCT_SERVICE", "BUSINESS_MODEL", "INDUSTRY", "TECHNOLOGY", "OFFERING_OVERLAP", "GEOGRAPHY", "EMPLOYEE_SIZE"];
/** Geography semantics that may decide an ICP GEOGRAPHY criterion. Legacy undefined is accepted. */
export const CRITERION_GEOGRAPHY_TYPES: ReadonlySet<string | undefined> = new Set(["HEADQUARTERS", "PRIMARY_OPERATING_GEOGRAPHY", undefined]);

export function claimTypeForIcpDimensionV2(dimension: string): ClaimTypeV2 {
  const upper = dimension.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return DIMENSION_CLAIM_TYPES.find(([pattern]) => pattern.test(upper))?.[1] ?? "ICP_CRITERION";
}

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") { const parsed = parseNumericClaimValueV2(value); return parsed && parsed.min === parsed.max ? parsed.min : null; }
  return null;
};
const stringList = (value: unknown): string[] | null => {
  const list = Array.isArray(value) ? value : [value];
  const strings = list.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return strings.length && strings.length === list.length ? strings : null;
};

/** Returns null for criteria that cannot be evidence-evaluated (e.g. BOOLEAN false). */
export function icpCriterionToRequirementV2(criterion: IcpCriterionLikeV2): ResearchRequirementV2 | null {
  const type = claimTypeForIcpDimensionV2(criterion.dimension);
  const base = {
    criterionId: criterion.id, type, mandatory: criterion.criterionType === "MUST_HAVE",
    exclusion: criterion.criterionType === "DISQUALIFIER", preferred: criterion.criterionType === "PREFERRED",
    dimension: criterion.dimension,
    ...(typeof criterion.description === "string" && criterion.description.trim() ? { description: criterion.description.trim().slice(0, 1000) } : {}),
  };
  const operator = criterion.operator.toUpperCase();
  let mapped: { operator: ResearchRequirementV2["operator"]; value?: RequirementValueV2 } | null = null;
  if (operator === "EXISTS") mapped = { operator: "EXISTS" };
  else if (operator === "BOOLEAN") mapped = criterion.value === true ? { operator: "EXISTS" } : null;
  else if (operator === "IN" || operator === "NOT_IN") {
    const list = stringList(criterion.value);
    mapped = list ? { operator, value: list } : null;
  } else if (operator === "BETWEEN") {
    const range = criterion.value && typeof criterion.value === "object" ? criterion.value as Record<string, unknown> : null;
    const min = finiteNumber(range?.min), max = finiteNumber(range?.max);
    mapped = min !== null || max !== null ? { operator: "BETWEEN", value: { ...(min !== null ? { min } : {}), ...(max !== null ? { max } : {}) } } : null;
  } else if (operator === "GT" || operator === "GTE" || operator === "LT" || operator === "LTE") {
    const bound = finiteNumber(criterion.value);
    mapped = bound === null ? null : { operator, value: operator.startsWith("G") ? { min: bound } : { max: bound } };
  } else if (operator === "EQUALS" || operator === "NOT_EQUALS" || operator === "CONTAINS" || operator === "NOT_CONTAINS") {
    const list = stringList(typeof criterion.value === "number" ? String(criterion.value) : criterion.value);
    mapped = list ? { operator, value: list.length === 1 ? list[0]! : list } : null;
  }
  if (!mapped) return null;
  const parsed = researchRequirementSchema.safeParse({ ...base, ...mapped });
  return parsed.success ? parsed.data : null;
}

export function icpCriteriaToRequirementsV2(criteria: IcpCriterionLikeV2[]): ResearchRequirementV2[] {
  return criteria.flatMap((criterion) => { const requirement = icpCriterionToRequirementV2(criterion); return requirement ? [requirement] : []; });
}

export function renderRequirementValueV2(value: RequirementValueV2 | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  if (value.min !== undefined && value.max !== undefined) return `${value.min}..${value.max}`;
  return value.min !== undefined ? `>= ${value.min}` : `<= ${value.max}`;
}

/** The exact criterion description shown to the model and re-checked by the validator. */
export function describeRequirementV2(requirement: ResearchRequirementV2): string {
  const rendered = renderRequirementValueV2(requirement.value);
  const core = `${requirement.type} ${requirement.operator}${rendered ? ` ${rendered}` : ""}`;
  const explained = requirement.description ? `${core} — ${requirement.description}` : core;
  return requirement.exclusion
    ? `EXCLUSION (PASS means the company EXHIBITS this excluded characteristic and is disqualified; FAIL means evidence shows it does not): ${explained}`
    : explained;
}

/* ---------- text matching ---------- */

const GEOGRAPHY_ALIASES: Array<[RegExp, string]> = [
  [/\bunited states of america\b/g, "united states"],
  [/\bu s a\b/g, "united states"], [/\busa\b/g, "united states"], [/\bu s\b/g, "united states"], [/\bus\b/g, "united states"],
  [/\bgreat britain\b/g, "united kingdom"], [/\bu k\b/g, "united kingdom"], [/\buk\b/g, "united kingdom"],
  [/\bu a e\b/g, "united arab emirates"], [/\buae\b/g, "united arab emirates"],
];
const normalizeText = (value: string, geography: boolean): string => {
  let text = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  if (geography) for (const [pattern, replacement] of GEOGRAPHY_ALIASES) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, " ").trim();
};
const SUFFIXES = ["ations", "ation", "ities", "ity", "ers", "er", "ing", "ies", "ied", "ed", "s"];
/** Light stemmer applied symmetrically so "manufacturing"/"manufacturers" and "service"/"services" compare equal. */
export function stemTokenV2(word: string): string {
  let base = word;
  for (const suffix of SUFFIXES) {
    if (base.endsWith(suffix) && base.length - suffix.length >= 4) { base = base.slice(0, -suffix.length); break; }
  }
  return base.endsWith("e") && base.length > 4 ? base.slice(0, -1) : base;
}
const tokensOf = (text: string) => text.split(" ").filter(Boolean).map(stemTokenV2);
/** Whole-token contiguous phrase containment; never a bare substring. */
function phraseIncluded(haystack: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > haystack.length) return false;
  outer: for (let start = 0; start + needle.length <= haystack.length; start++) {
    for (let offset = 0; offset < needle.length; offset++) if (haystack[start + offset] !== needle[offset]) continue outer;
    return true;
  }
  return false;
}
function textMatches(claimValue: string, target: string, mode: "EQUALS" | "PHRASE", geography: boolean): boolean {
  const claim = tokensOf(normalizeText(claimValue, geography));
  const expected = tokensOf(normalizeText(target, geography));
  if (!claim.length || !expected.length) return false;
  if (mode === "EQUALS") return claim.length === expected.length && claim.every((token, index) => token === expected[index]);
  return phraseIncluded(claim, expected);
}

/* ---------- numeric parsing ---------- */

const NUMERIC_CLAIM = /^\s*(?:about|approx(?:imately)?|around|over|more than|at least|up to|under|less than|circa|c\.)?\s*(?:[$€£])?\s*(\d[\d,]*(?:\.\d+)?)\s*([kmb])?\s*(\+)?\s*(?:(?:-|–|—|to)\s*(?:[$€£])?\s*(\d[\d,]*(?:\.\d+)?)\s*([kmb])?)?\s*(?:employees?|people|staff|headcount|ftes?|team members|revenue|usd|eur|gbp|annual(?:ly)?|per year|arr)?\s*\.?\s*$/i;
const scale = (suffix: string | undefined) => suffix ? ({ k: 1e3, m: 1e6, b: 1e9 } as Record<string, number>)[suffix.toLowerCase()] ?? 1 : 1;
/** Parses strings like "200", "1,000+", "51-200 employees", "$5M-$10M". Free text returns null. */
export function parseNumericClaimValueV2(value: string): { min: number; max: number } | null {
  const match = NUMERIC_CLAIM.exec(value);
  if (!match) return null;
  const first = Number(match[1]!.replace(/,/g, "")) * scale(match[2]);
  if (!Number.isFinite(first)) return null;
  if (match[4]) {
    const second = Number(match[4].replace(/,/g, "")) * scale(match[5] ?? match[2]);
    return Number.isFinite(second) && second >= first ? { min: first, max: second } : null;
  }
  return { min: first, max: match[3] ? Number.POSITIVE_INFINITY : first };
}
const requirementRange = (value: RequirementValueV2 | undefined): { min: number; max: number } | null => {
  if (value === undefined) return null;
  if (typeof value === "string") return parseNumericClaimValueV2(value);
  if (Array.isArray(value)) return null;
  return { min: value.min ?? Number.NEGATIVE_INFINITY, max: value.max ?? Number.POSITIVE_INFINITY };
};

/* ---------- evaluation ---------- */

const NUMERIC_OPERATORS = new Set<ResearchRequirementV2["operator"]>(["BETWEEN", "GT", "GTE", "LT", "LTE"]);
const NEGATIVE_OPERATORS = new Set<ResearchRequirementV2["operator"]>(["NOT_EQUALS", "NOT_CONTAINS", "NOT_IN"]);
export const isNegativeRequirementOperatorV2 = (operator: ResearchRequirementV2["operator"]) => NEGATIVE_OPERATORS.has(operator);
/** The prohibited values of a negative-operator requirement, for absence attestations. */
export function prohibitedRequirementValuesV2(requirement: ResearchRequirementV2): string[] {
  if (!isNegativeRequirementOperatorV2(requirement.operator) || requirement.value === undefined) return [];
  return typeof requirement.value === "string" ? [requirement.value] : Array.isArray(requirement.value) ? requirement.value : [];
}

/**
 * Decides whether a claim value satisfies a requirement.
 * true = satisfies (PASS-compatible), false = contradicts (FAIL-compatible),
 * null = this claim value cannot decide the requirement (e.g. non-numeric text
 * for a numeric operator, or a missing requirement value).
 */
export function criterionSatisfiedBy(requirement: Pick<ResearchRequirementV2, "type" | "operator" | "value" | "dimension">, claimValue: string): boolean | null {
  const { operator } = requirement;
  if (operator === "EXISTS") return true;
  if (requirement.value === undefined) return null;
  const geography = requirement.type === "GEOGRAPHY" || /geograph|country|region|location/i.test(requirement.dimension ?? "");
  if (NUMERIC_OPERATORS.has(operator)) {
    const claim = parseNumericClaimValueV2(claimValue);
    const range = requirementRange(requirement.value);
    if (!claim || !range) return null;
    if (operator === "BETWEEN") return claim.min <= range.max && claim.max >= range.min;
    if (operator === "GTE") return claim.max >= range.min;
    if (operator === "GT") return claim.max > range.min;
    if (operator === "LTE") return claim.min <= range.max;
    return claim.min < range.max;
  }
  const targets = typeof requirement.value === "string" ? [requirement.value] : Array.isArray(requirement.value) ? requirement.value : null;
  if (!targets) return null;
  const positive = operator === "EQUALS" || operator === "NOT_EQUALS"
    ? targets.some((target) => {
        const numericClaim = parseNumericClaimValueV2(claimValue), numericTarget = parseNumericClaimValueV2(target);
        return numericClaim && numericTarget
          ? numericClaim.min <= numericTarget.max && numericClaim.max >= numericTarget.min
          : textMatches(claimValue, target, "EQUALS", geography);
      })
    : targets.some((target) => textMatches(claimValue, target, "PHRASE", geography));
  return NEGATIVE_OPERATORS.has(operator) ? !positive : positive;
}

/** Whether an atomic claim is structurally eligible to decide a requirement (type + geography semantics). */
export function claimEligibleForRequirementV2(requirement: Pick<ResearchRequirementV2, "type" | "dimension">, claim: Pick<AtomicClaimV2, "type" | "geographyType">): boolean {
  const typeMatch = requirement.type === "ICP_CRITERION" ? WILDCARD_CRITERION_CLAIM_TYPES.includes(claim.type) : claim.type === requirement.type;
  if (!typeMatch) return false;
  // A wildcard dimension (revenue, buyer maturity...) is never decided by an employee count.
  if (requirement.type === "ICP_CRITERION" && claim.type === "EMPLOYEE_SIZE" && !/employee|headcount|size/i.test(requirement.dimension ?? "")) return false;
  if (claim.type === "GEOGRAPHY" && requirement.type === "GEOGRAPHY") return CRITERION_GEOGRAPHY_TYPES.has(claim.geographyType);
  return true;
}

/** Deterministic PASS/FAIL/UNKNOWN from the claims present (no absence proof). */
export function evaluateRequirementAgainstClaimsV2(requirement: ResearchRequirementV2, claims: Array<Pick<AtomicClaimV2, "type" | "value" | "geographyType">>): "PASS" | "FAIL" | "UNKNOWN" {
  const decisions = claims.filter((claim) => claimEligibleForRequirementV2(requirement, claim))
    .map((claim) => criterionSatisfiedBy(requirement, claim.value)).filter((decision): decision is boolean => decision !== null);
  if (!decisions.length) return "UNKNOWN";
  if (isNegativeRequirementOperatorV2(requirement.operator)) return decisions.every(Boolean) ? "UNKNOWN" : "FAIL";
  return decisions.some(Boolean) ? "PASS" : "FAIL";
}
