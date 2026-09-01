export type IcpDimensionResult = "pass" | "partial" | "fail" | "unknown";
export type IcpFitStatus = "LIKELY_FIT" | "POSSIBLE_FIT" | "LIKELY_NOT_FIT" | "INSUFFICIENT_DATA";

export type EmployeeRangeEvidence = {
  label: string;
  minimum: number;
  maximum: number | null;
};

const INDUSTRY_GROUPS = [
  ["software", "computer software", "saas", "enterprise software", "software development"],
  ["information technology", "it services", "it consulting", "technology", "technology information and internet"],
  ["financial services", "fintech", "banking", "insurance"],
  ["healthcare", "hospital", "health technology", "medical"],
  ["professional services", "consulting", "business consulting"],
];

export function normalizeGeography(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\bunited states of america\b|\busa\b|\bu s a\b/g, "united states")
    .replace(/\bunited kingdom\b|\buk\b|\bu k\b/g, "united kingdom")
    .replace(/\bunited arab emirates\b|\buae\b|\bu a e\b/g, "united arab emirates");
}

export function geographyMatches(value: string | null, targets: string[]): boolean | null {
  if (!value || !targets.length) return null;
  const normalized = normalizeGeography(value);
  return targets.some((target) => {
    const candidate = normalizeGeography(target);
    return normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized);
  });
}

export function industryMatches(value: string | null, targets: string[]): boolean | null {
  if (!value || !targets.length) return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return targets.some((target) => {
    const candidate = target.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized)) return true;
    return INDUSTRY_GROUPS.some((group) =>
      group.some((alias) => normalized.includes(alias)) &&
      group.some((alias) => candidate.includes(alias)));
  });
}

/**
 * Interpret an observed employee band without claiming a point estimate.  A
 * provider's range is more specific than its count only when it is present.
 */
export function parseEmployeeRange(value: unknown): EmployeeRangeEvidence | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.replace(/,/g, "").trim();
  const band = raw.match(/(\d+)\s*(?:[-–—]|to)\s*(\d+)/i);
  if (band) return { minimum: Number(band[1]), maximum: Number(band[2]), label: value };
  const plus = raw.match(/(\d+)\s*\+/);
  if (plus) return { minimum: Number(plus[1]), maximum: null, label: value };
  const exact = raw.match(/\b(\d+)\b/);
  return exact ? { minimum: Number(exact[1]), maximum: Number(exact[1]), label: value } : null;
}

export function employeeRangeDecision(
  observed: EmployeeRangeEvidence | null,
  target: { minimum?: unknown; maximum?: unknown } | undefined,
): IcpDimensionResult {
  const minimum = typeof target?.minimum === "number" ? target.minimum : null;
  const maximum = typeof target?.maximum === "number" ? target.maximum : null;
  if (!observed || minimum === null || maximum === null) return "unknown";
  if (observed.minimum > maximum || (observed.maximum !== null && observed.maximum < minimum)) {
    return "fail";
  }
  return observed.minimum >= minimum && observed.maximum !== null && observed.maximum <= maximum
    ? "pass"
    : "partial";
}

/**
 * A partially overlapping dimension is useful qualification evidence but must
 * not by itself promote an account to LIKELY_FIT.
 */
export function classifyIcpFit(dimensions: {
  geography: IcpDimensionResult;
  industry: IcpDimensionResult;
  employeeSize: IcpDimensionResult;
}): { status: IcpFitStatus; confidence: "HIGH" | "MEDIUM" | "LOW" } {
  if ([dimensions.geography, dimensions.industry, dimensions.employeeSize].includes("fail")) {
    return { status: "LIKELY_NOT_FIT", confidence: "HIGH" };
  }
  const values = [dimensions.geography, dimensions.industry, dimensions.employeeSize];
  const passes = values.filter((value) => value === "pass").length;
  const partials = values.filter((value) => value === "partial").length;
  if (passes >= 2 && partials === 0) {
    return {
      status: "LIKELY_FIT",
      confidence: values.every((value) => value === "pass") ? "HIGH" : "MEDIUM",
    };
  }
  if (passes + partials >= 1) return { status: "POSSIBLE_FIT", confidence: "MEDIUM" };
  return { status: "INSUFFICIENT_DATA", confidence: "LOW" };
}