import type { IcpCriterion } from "@workspace/db";
import { z } from "zod/v4";

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

export function parseEmployeeRange(value: string): { min: number; max: number | null } | null {
  const normalized = value.trim().replace(/[–—]/g, "-").replace(/,/g, "");
  const open = normalized.match(/^(\d+)\s*\+$/);
  if (open) return { min: Number(open[1]), max: null };
  const bounded = normalized.match(/^(\d+)\s*(?:-|to)\s*(\d+)$/i);
  if (!bounded) return null;
  const min = Number(bounded[1]);
  const max = Number(bounded[2]);
  return min <= max ? { min, max } : null;
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
    const value = numeric(fact);
    const range = rangeSchema.safeParse(criterion.value);
    if (value === null || !range.success) return "unknown";
    return value >= range.data.min && (range.data.max === null || value <= range.data.max) ? "pass" : "fail";
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

function splitValues(value: string): string[] {
  return value.split(/[,/;]|\bor\b/i).map((part) => part.trim()).filter(Boolean);
}

function customerIndustries(raw: string): string[] {
  const known = ["saas", "software", "it", "technology", "fintech", "healthcare", "manufacturing", "professional services"];
  return known.filter((item) => raw.toLowerCase().includes(item));
}

export function generateIcpCriteria(rawAnswers: Record<string, unknown>, interpretation?: Record<string, unknown>): IcpCriterionInput[] {
  const raw = (key: string) => typeof rawAnswers[key] === "string" ? String(rawAnswers[key]).trim() : "";
  const result: IcpCriterionInput[] = [];
  const add = (criterion: IcpCriterionInput) => result.push(criterion);
  const industries = customerIndustries(raw("typicalCustomerProfile"));
  const sellerIndustry = raw("industry");
  if (industries.length) {
    add({ dimension: "industry", operator: "IN", value: industries, weight: null, criterionType: "MUST_HAVE", description: "Target customer operates in a stated target industry.", source: "business_twin", evaluability: "scorable" });
  } else if (sellerIndustry) {
    add({ dimension: "industry", operator: "CONTAINS", value: sellerIndustry, weight: null, criterionType: "MUST_HAVE", description: "Target customer should match the industry context provided in the Business Twin.", source: "business_twin", evaluability: "scorable" });
  }
  const geographies = splitValues(raw("targetGeographies") || raw("primaryGeography"));
  if (geographies.length) {
    add({ dimension: "geography", operator: "IN", value: geographies, weight: null, criterionType: "MUST_HAVE", description: "Company is located in a stated target geography.", source: "business_twin", evaluability: "scorable" });
  }
  const employeeRange = parseEmployeeRange(raw("typicalEmployeeRange"));
  if (employeeRange) {
    add({ dimension: "employee_count", operator: "BETWEEN", value: employeeRange, weight: null, criterionType: "MUST_HAVE", description: "Company employee count falls within the seller's stated target range.", source: "business_twin", evaluability: "scorable" });
  }
  const patterns = Array.isArray(interpretation?.technology_patterns) ? interpretation?.technology_patterns : [];
  if (patterns.length) {
    add({ dimension: "technology", operator: "IN", value: patterns, weight: 10, criterionType: "PREFERRED", description: "Technology pattern suggested by the Business Twin interpretation.", source: "business_twin", evaluability: "scorable" });
  }
  const compliance = Array.isArray(interpretation?.compliance_patterns) ? interpretation?.compliance_patterns : [];
  if (compliance.length) {
    add({ dimension: "compliance", operator: "IN", value: compliance, weight: 10, criterionType: "PREFERRED", description: "Compliance context may improve commercial fit but is not mandatory.", source: "business_twin", evaluability: "scorable" });
  }
  const rawDisqualifier = raw("badCustomerCharacteristics");
  const negativePatterns = (Array.isArray(interpretation?.negative_customer_patterns) ? interpretation.negative_customer_patterns : [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const hypotheses = (Array.isArray(interpretation?.disqualifier_hypotheses) ? interpretation.disqualifier_hypotheses : [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (rawDisqualifier) {
    add({ dimension: "negative_indicator", operator: "CONTAINS", value: rawDisqualifier, weight: null, criterionType: "DISQUALIFIER", description: "Seller-stated negative customer characteristic. Once accepted, confirmed presence disqualifies the account.", source: "business_twin", evaluability: "scorable" });
  } else {
    for (const pattern of negativePatterns) {
      add({ dimension: "negative_indicator", operator: "CONTAINS", value: pattern, weight: null, criterionType: "DISQUALIFIER", description: "Suggested negative customer pattern. Review and accept it before it can affect objective fit.", source: "business_twin", evaluability: "scorable" });
    }
  }
  for (const hypothesis of hypotheses) {
    add({ dimension: "negative_indicator", operator: "CONTAINS", value: hypothesis, weight: null, criterionType: "ADVISORY", description: "A Business Twin hypothesis that requires human validation before becoming a disqualifier.", source: "business_twin", evaluability: "advisory" });
  }
  const advisoryText = raw("typicalUrgencyTriggers") || raw("majorDifferentiators");
  if (advisoryText) {
    add({ dimension: "positive_indicator", operator: "CONTAINS", value: advisoryText, weight: null, criterionType: "ADVISORY", description: "Commercially meaningful indicator that requires research before it can be scored.", source: "business_twin", evaluability: "advisory" });
  }
  return result;
}