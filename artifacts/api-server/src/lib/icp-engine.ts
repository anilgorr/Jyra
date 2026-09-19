import type { IcpCriterion } from "@workspace/db";
import { z } from "zod/v4";
import { geographyMatch, industryMatch, invertMatch } from "./icp-match";
import {
  BUSINESS_MATURITY_STAGES,
  EVIDENCE_PROVENANCE,
  VALIDATION_STATUSES,
  hasSubstantialBusinessEvidence,
  type BusinessTwinRawAnswers,
} from "./business-twin-schemas";

export const ICP_DIMENSIONS = [
  "industry",
  "geography",
  "employee_count",
  "revenue",
  "business_model",
  "technology",
  "buyer_maturity",
  "positive_indicator",
  "negative_indicator",
  "compliance",
] as const;
export const ICP_OPERATORS = [
  "EQUALS",
  "NOT_EQUALS",
  "IN",
  "NOT_IN",
  "GT",
  "GTE",
  "LT",
  "LTE",
  "BETWEEN",
  "CONTAINS",
  "EXISTS",
  "BOOLEAN",
] as const;
export const ICP_CRITERION_TYPES = [
  "MUST_HAVE",
  "PREFERRED",
  "DISQUALIFIER",
  "ADVISORY",
] as const;
export const ICP_EVALUABILITY = ["scorable", "advisory"] as const;

const rangeSchema = z
  .object({ min: z.number().finite(), max: z.number().finite().nullable() })
  .strict()
  .refine(({ max, min }) => max === null || min <= max, "Invalid range");

const numericDimensions = new Set<(typeof ICP_DIMENSIONS)[number]>([
  "employee_count",
  "revenue",
]);
const textualDimensions = new Set<(typeof ICP_DIMENSIONS)[number]>([
  "industry",
  "geography",
  "business_model",
  "technology",
  "buyer_maturity",
  "positive_indicator",
  "negative_indicator",
  "compliance",
]);
const numericOperators = new Set<(typeof ICP_OPERATORS)[number]>([
  "EQUALS",
  "NOT_EQUALS",
  "GT",
  "GTE",
  "LT",
  "LTE",
  "BETWEEN",
  "EXISTS",
]);
const textualOperators = new Set<(typeof ICP_OPERATORS)[number]>([
  "EQUALS",
  "NOT_EQUALS",
  "IN",
  "NOT_IN",
  "CONTAINS",
  "EXISTS",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringSet(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

export function isValidCriterionValue(
  dimension: (typeof ICP_DIMENSIONS)[number],
  operator: (typeof ICP_OPERATORS)[number],
  value: unknown,
): boolean {
  if (operator === "EXISTS") return value === true;
  if (operator === "BOOLEAN") return dimension === "compliance" && typeof value === "boolean";
  if (numericDimensions.has(dimension)) {
    if (!numericOperators.has(operator)) return false;
    if (operator === "BETWEEN") return rangeSchema.safeParse(value).success;
    return typeof value === "number" && Number.isFinite(value);
  }
  if (!textualDimensions.has(dimension) || !textualOperators.has(operator)) return false;
  if (operator === "IN" || operator === "NOT_IN") return isStringSet(value);
  return isNonEmptyString(value);
}

export const icpCriterionInputSchema = z
  .object({
    dimension: z.enum(ICP_DIMENSIONS),
    operator: z.enum(ICP_OPERATORS),
    value: z.unknown(),
    weight: z.number().finite().min(0).max(100).nullable(),
    criterionType: z.enum(ICP_CRITERION_TYPES),
    description: z.string().trim().min(1).max(2000),
    source: z.enum(["business_twin", "manual"]),
    evaluability: z.enum(ICP_EVALUABILITY),
    provenance: z.enum(EVIDENCE_PROVENANCE).default("USER_CONFIRMED"),
    validationStatus: z.enum(VALIDATION_STATUSES).default("UNKNOWN"),
  })
  .strict()
  .superRefine((criterion, ctx) => {
    if (criterion.criterionType === "ADVISORY" && criterion.evaluability !== "advisory") {
      ctx.addIssue({ code: "custom", path: ["evaluability"], message: "Advisory criteria are not scorable" });
    }
    if (criterion.criterionType !== "ADVISORY" && criterion.evaluability !== "scorable") {
      ctx.addIssue({ code: "custom", path: ["evaluability"], message: "This criterion is scorable" });
    }
    if (!isValidCriterionValue(criterion.dimension, criterion.operator, criterion.value)) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `Invalid ${criterion.operator} value for ${criterion.dimension}`,
      });
    }
    if (criterion.criterionType === "PREFERRED") {
      if (criterion.weight === null || criterion.weight <= 0) {
        ctx.addIssue({ code: "custom", path: ["weight"], message: "Preferred criteria require a weight greater than zero" });
      }
    } else if (criterion.weight !== null) {
      ctx.addIssue({ code: "custom", path: ["weight"], message: "Only preferred criteria may have a weight" });
    }
  });

export type IcpCriterionInput = z.infer<typeof icpCriterionInputSchema>;
export type CompanyFacts = Partial<Record<(typeof ICP_DIMENSIONS)[number], unknown>>;
export type CriterionResult = "pass" | "fail" | "unknown" | "not_applicable";

/**
 * The seller's target headcount, from however they wrote it.
 *
 * The wizard's size question is a multi-select whose picks are joined with
 * "; ", so a seller who ticks four bands sends "50-200 employees; 201-500
 * employees; 501-1,000 employees; 1,000-2,000 employees". This used to be
 * anchored to one bare range and returned null for all of it - no criterion,
 * no size filter, and nothing anywhere said so. Read every band and span
 * them: the bands are contiguous by construction, and a seller who ticks the
 * ends means the middle.
 *
 * An unbounded band ("2,000+") anywhere makes the whole range unbounded.
 */
export function parseEmployeeRange(value: string): { min: number; max: number | null } | null {
  const bands = value
    .replace(/[–—]/g, "-")
    .replace(/,(?=\d{3}\b)/g, "")
    .split(/[;\n]|\bor\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
  let min: number | null = null;
  let max: number | null = null;
  let unbounded = false;
  for (const band of bands) {
    const open = band.match(/(?:^|\s)(\d+)\s*\+/);
    if (open) {
      const low = Number(open[1]);
      min = min === null ? low : Math.min(min, low);
      unbounded = true;
      continue;
    }
    const bounded = band.match(/(?:^|\s)(\d+)\s*(?:-|to)\s*(\d+)/i);
    if (!bounded) continue;
    const low = Number(bounded[1]);
    const high = Number(bounded[2]);
    if (low > high) continue;
    min = min === null ? low : Math.min(min, low);
    max = max === null ? high : Math.max(max, high);
  }
  if (min === null) return null;
  return { min, max: unbounded ? null : max };
}

/**
 * A headcount the source stated as a band, not a number.
 *
 * LinkedIn publishes "201-500 employees" and "10,001+ employees", never a
 * count, and that band is the only headcount this system has for any company
 * in the launch pool - the firmographics provider that was meant to supply a
 * number has refused every request the pipeline has made. `numeric("201-500")`
 * is NaN, so a stated size evaluated as unknown and the seller's mandatory
 * size criterion could never bite.
 */
export function parseStatedBand(value: unknown): { min: number; max: number | null } | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u2013\u2014]/g, "-").replace(/,(?=\d{3}\b)/g, "").trim();
  const open = text.match(/^(\d+)\s*\+$/);
  if (open) return { min: Number(open[1]), max: null };
  const bounded = text.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!bounded) return null;
  const min = Number(bounded[1]);
  const max = Number(bounded[2]);
  return min <= max ? { min, max } : null;
}

/**
 * A band against a target range, three ways.
 *
 * Wholly inside passes and wholly outside fails, but a band that straddles
 * the boundary is genuinely undecided - "1,001-5,000" against a target of
 * 50-2,000 could be either - and this system's rule throughout is that
 * unknown is not failure. Calling it a fail would disqualify companies on a
 * coin flip; calling it a pass would admit them the same way.
 */
function bandWithin(band: { min: number; max: number | null }, target: { min: number; max: number | null }): CriterionResult {
  const targetMax = target.max ?? Infinity;
  const bandMax = band.max ?? Infinity;
  if (band.min >= target.min && bandMax <= targetMax) return "pass";
  if (bandMax < target.min || band.min > targetMax) return "fail";
  return "unknown";
}

function normalized(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function evaluateIcpCriterion(
  criterion: Pick<IcpCriterion, "operator" | "value" | "accepted" | "evaluability">,
  facts: CompanyFacts,
  dimension: string,
): CriterionResult {
  if (!criterion.accepted || criterion.evaluability !== "scorable") {
    return "not_applicable";
  }
  if (!isValidCriterionValue(dimension as (typeof ICP_DIMENSIONS)[number], criterion.operator, criterion.value)) {
    return "unknown";
  }
  const fact = facts[dimension as keyof CompanyFacts];
  if (fact === null || fact === undefined || fact === "") return "unknown";
  const op = criterion.operator;
  if (op === "EXISTS") return "pass";
  if (op === "BOOLEAN") return fact === criterion.value ? "pass" : "fail";
  if (op === "BETWEEN") {
    const range = rangeSchema.safeParse(criterion.value);
    if (!range.success) return "unknown";
    const value = numeric(fact);
    if (value !== null) {
      return value >= range.data.min && (range.data.max === null || value <= range.data.max) ? "pass" : "fail";
    }
    const band = parseStatedBand(fact);
    if (band) return bandWithin(band, range.data);
    return "unknown";
  }
  if (numericDimensions.has(dimension as (typeof ICP_DIMENSIONS)[number]) &&
    (op === "EQUALS" || op === "NOT_EQUALS")) {
    const left = numeric(fact);
    const right = numeric(criterion.value);
    if (left === null || right === null) return "unknown";
    const equal = left === right;
    return op === "EQUALS" ? (equal ? "pass" : "fail") : (equal ? "fail" : "pass");
  }
  if (["GT", "GTE", "LT", "LTE"].includes(op)) {
    const left = numeric(fact);
    const right = numeric(criterion.value);
    if (left === null || right === null) return "unknown";
    if (op === "GT") return left > right ? "pass" : "fail";
    if (op === "GTE") return left >= right ? "pass" : "fail";
    if (op === "LT") return left < right ? "pass" : "fail";
    return left <= right ? "pass" : "fail";
  }
  const left = normalized(fact);
  if (left === null) return "unknown";
  if (op === "CONTAINS") {
    const right = normalized(criterion.value);
    return right === null ? "unknown" : left.includes(right) ? "pass" : "fail";
  }
  if (op === "IN" || op === "NOT_IN") {
    if (!Array.isArray(criterion.value)) return "unknown";
    // Industry and geography are written in words on both sides ("IT
    // services" vs "Information technology & services"; "US" vs "United
    // States"; "North America" vs "Canada"), so they are compared by
    // meaning, not by string. Anything the matcher cannot place is unknown.
    if (dimension === "industry") {
      const matched = industryMatch(fact, criterion.value);
      return op === "IN" ? matched : invertMatch(matched);
    }
    if (dimension === "geography") {
      const matched = geographyMatch(fact, criterion.value);
      return op === "IN" ? matched : invertMatch(matched);
    }
    const values = criterion.value.map(normalized).filter((value): value is string => value !== null);
    const included = values.includes(left);
    return op === "IN" ? (included ? "pass" : "fail") : (included ? "fail" : "pass");
  }
  const right = normalized(criterion.value);
  if (right === null) return "unknown";
  return op === "EQUALS"
    ? (left === right ? "pass" : "fail")
    : (left !== right ? "pass" : "fail");
}

/**
 * The separators a seller actually uses.
 *
 * Newlines were missing, and the wizard's list fields are newline-joined, so
 * a five-line geography answer split only on the commas inside its last line:
 * "United States and Canada\nUnited Kingdom and Ireland\n...\nAustralia, New
 * Zealand, and India" became one four-line blob plus "New Zealand" plus "and
 * India". A blob matches no country, so the mandatory geography criterion was
 * decided by whichever fragment happened to parse.
 *
 * A newline binds tighter than a comma, so split on lines first and only then
 * on in-line separators - that keeps "Australia, New Zealand, and India"
 * splitting into three while leaving a line that merely contains a comma
 * intact when it is the whole entry.
 */
function splitValues(value: string): string[] {
  return value
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[,/;]|\bor\b/i))
    .map((part) => part.trim().replace(/^and\s+/i, "").trim())
    .filter(Boolean);
}

function customerIndustries(raw: string): string[] {
  const known = ["saas", "software", "it", "technology", "fintech", "healthcare", "manufacturing", "professional services"];
  return known.filter((item) => raw.toLowerCase().includes(item));
}

export const ICP_MODES = [
  "HYPOTHESIS_ICP",
  "EARLY_EVIDENCE_ICP",
  "VALIDATED_ICP",
] as const;

export type IcpMode = (typeof ICP_MODES)[number];

export type IcpGenerationContext = {
  icpMode: IcpMode | null;
  modeExplanation: string | null;
  assumptions: string[];
};

function readString(rawAnswers: Record<string, unknown>, key: string): string {
  return typeof rawAnswers[key] === "string"
    ? String(rawAnswers[key]).trim()
    : "";
}

export function deriveIcpGenerationContext(
  rawAnswers: Record<string, unknown>,
): IcpGenerationContext {
  const stageValue = rawAnswers.businessMaturityStage;
  const stage = BUSINESS_MATURITY_STAGES.includes(
    stageValue as (typeof BUSINESS_MATURITY_STAGES)[number],
  )
    ? (stageValue as (typeof BUSINESS_MATURITY_STAGES)[number])
    : null;
  const substantialEvidence = hasSubstantialBusinessEvidence(
    rawAnswers as BusinessTwinRawAnswers,
  );

  const icpMode: IcpMode = substantialEvidence
    ? "VALIDATED_ICP"
    : stage === "EARLY_CUSTOMERS" ||
        stage === "REPEATABLE_SALES" ||
        stage === "ESTABLISHED"
      ? "EARLY_EVIDENCE_ICP"
      : "HYPOTHESIS_ICP";

  const modeExplanation =
    icpMode === "VALIDATED_ICP"
      ? "This evidence-led ICP is grounded in the customer volume and repeated sales outcomes explicitly supplied in this Business Twin. It remains versioned and changes only with user approval."
      : icpMode === "EARLY_EVIDENCE_ICP"
        ? "Early evidence suggests these patterns, but the sample is not treated as definitive. Review each criterion and continue testing the assumptions against real outcomes."
        : "This ICP is based primarily on your current market assumptions. JYRA will help test and refine it as real outcomes accumulate; no customer validation is implied.";

  const assumptions = [
    readString(rawAnswers, "marketHypotheses"),
    readString(rawAnswers, "typicalCustomerProfile")
      ? `We believe ${readString(rawAnswers, "typicalCustomerProfile")}.`
      : "",
    readString(rawAnswers, "typicalEmployeeRange")
      ? `We believe companies with ${readString(rawAnswers, "typicalEmployeeRange")} employees are a strong fit.`
      : "",
    readString(rawAnswers, "commonBuyerRoles")
      ? `We believe ${readString(rawAnswers, "commonBuyerRoles")} is involved in buying.`
      : "",
    readString(rawAnswers, "commonChampionRoles")
      ? `We believe ${readString(rawAnswers, "commonChampionRoles")} can champion the purchase.`
      : "",
    readString(rawAnswers, "typicalUrgencyTriggers")
      ? `We believe urgency increases when ${readString(rawAnswers, "typicalUrgencyTriggers")}.`
      : "",
  ]
    .map((assumption) => assumption.trim())
    .filter(Boolean);

  return {
    icpMode,
    modeExplanation,
    assumptions: Array.from(new Set(assumptions)).slice(0, 20),
  };
}

export function generateIcpCriteria(rawAnswers: Record<string, unknown>, interpretation?: Record<string, unknown>): IcpCriterionInput[] {
  const raw = (key: string) => typeof rawAnswers[key] === "string" ? String(rawAnswers[key]).trim() : "";
  const context = deriveIcpGenerationContext(rawAnswers);
  const provenance =
    context.icpMode === "HYPOTHESIS_ICP"
      ? "FOUNDER_HYPOTHESIS"
      : context.icpMode === "VALIDATED_ICP"
        ? "SALES_OUTCOME"
        : "CUSTOMER";
  const validationStatus =
    context.icpMode === "HYPOTHESIS_ICP"
      ? "UNTESTED"
      : context.icpMode === "VALIDATED_ICP"
        ? "VALIDATED"
        : "PARTIALLY_VALIDATED";
  const metadata = { provenance, validationStatus } as const;
  const result: IcpCriterionInput[] = [];
  const add = (criterion: IcpCriterionInput) => result.push(criterion);
  const industries = customerIndustries(raw("typicalCustomerProfile"));
  const sellerIndustry = raw("industry");
  if (industries.length) {
    add({ dimension: "industry", operator: "IN", value: industries, weight: null, criterionType: "MUST_HAVE", description: "Target customer operates in a stated target industry.", source: "business_twin", evaluability: "scorable", ...metadata });
  } else if (sellerIndustry) {
    add({ dimension: "industry", operator: "CONTAINS", value: sellerIndustry, weight: null, criterionType: "MUST_HAVE", description: "Target customer should match the industry context provided in the Business Twin.", source: "business_twin", evaluability: "scorable", ...metadata });
  }
  const geographies = splitValues(raw("targetGeographies") || raw("primaryGeography"));
  if (geographies.length) {
    add({ dimension: "geography", operator: "IN", value: geographies, weight: null, criterionType: "MUST_HAVE", description: "Company is located in a stated target geography.", source: "business_twin", evaluability: "scorable", ...metadata });
  }
  const employeeRange = parseEmployeeRange(raw("typicalEmployeeRange"));
  if (employeeRange) {
    add({ dimension: "employee_count", operator: "BETWEEN", value: employeeRange, weight: null, criterionType: "MUST_HAVE", description: "Company employee count falls within the seller's stated target range.", source: "business_twin", evaluability: "scorable", ...metadata });
  }
  const patterns = Array.isArray(interpretation?.technology_patterns) ? interpretation?.technology_patterns : [];
  if (patterns.length) {
    add({ dimension: "technology", operator: "IN", value: patterns, weight: 10, criterionType: "PREFERRED", description: "Technology pattern suggested by the Business Twin interpretation.", source: "business_twin", evaluability: "scorable", provenance: "AI_INFERRED", validationStatus: context.icpMode === "VALIDATED_ICP" ? "PARTIALLY_VALIDATED" : "UNTESTED" });
  }
  const compliance = Array.isArray(interpretation?.compliance_patterns) ? interpretation?.compliance_patterns : [];
  if (compliance.length) {
    add({ dimension: "compliance", operator: "IN", value: compliance, weight: 10, criterionType: "PREFERRED", description: "Compliance context may improve commercial fit but is not mandatory.", source: "business_twin", evaluability: "scorable", provenance: "AI_INFERRED", validationStatus: context.icpMode === "VALIDATED_ICP" ? "PARTIALLY_VALIDATED" : "UNTESTED" });
  }
  const rawDisqualifier = raw("badCustomerCharacteristics");
  const negativePatterns = (Array.isArray(interpretation?.negative_customer_patterns) ? interpretation.negative_customer_patterns : [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const hypotheses = (Array.isArray(interpretation?.disqualifier_hypotheses) ? interpretation.disqualifier_hypotheses : [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (rawDisqualifier) {
    add({ dimension: "negative_indicator", operator: "CONTAINS", value: rawDisqualifier, weight: null, criterionType: "DISQUALIFIER", description: "Seller-stated negative customer characteristic. Once accepted, confirmed presence disqualifies the account.", source: "business_twin", evaluability: "scorable", ...metadata });
  } else {
    for (const pattern of negativePatterns) {
      add({ dimension: "negative_indicator", operator: "CONTAINS", value: pattern, weight: null, criterionType: "DISQUALIFIER", description: "Suggested negative customer pattern. Review and accept it before it can affect objective fit.", source: "business_twin", evaluability: "scorable", provenance: "AI_INFERRED", validationStatus: "UNTESTED" });
    }
  }
  for (const hypothesis of hypotheses) {
    add({ dimension: "negative_indicator", operator: "CONTAINS", value: hypothesis, weight: null, criterionType: "ADVISORY", description: "A Business Twin hypothesis that requires human validation before becoming a disqualifier.", source: "business_twin", evaluability: "advisory", provenance: "AI_INFERRED", validationStatus: "UNTESTED" });
  }
  const advisoryText = raw("typicalUrgencyTriggers") || raw("majorDifferentiators");
  if (advisoryText) {
    add({ dimension: "positive_indicator", operator: "CONTAINS", value: advisoryText, weight: null, criterionType: "ADVISORY", description: "Commercially meaningful indicator that requires research before it can be scored.", source: "business_twin", evaluability: "advisory", ...metadata });
  }
  return result;
}