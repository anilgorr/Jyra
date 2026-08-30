export interface RawCompanyInput {
  canonicalName?: unknown;
  domain?: unknown;
  website?: unknown;
  linkedinUrl?: unknown;
  country?: unknown;
  industry?: unknown;
  employeeCount?: unknown;
  employeeRange?: unknown;
  description?: unknown;
}

export interface NormalizedCompanyInput {
  canonicalName: string;
  domain: string | null;
  website: string | null;
  linkedinUrl: string | null;
  country: string | null;
  industry: string | null;
  employeeCount: number | null;
  employeeRange: string | null;
  description: string | null;
}

const LEGAL_TOKEN_EXPANSIONS: Record<string, string> = {
  pvt: "private",
  ltd: "limited",
  inc: "incorporated",
  corp: "corporation",
  co: "company",
};

const NON_DISTINCTIVE_SUFFIXES = new Set([
  "private",
  "limited",
  "incorporated",
  "corporation",
  "company",
  "llc",
  "llp",
  "plc",
  "group",
  "holdings",
  "technology",
  "technologies",
]);

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error("Expected text");
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed || null;
}

export function normalizeDomain(value: unknown): string | null {
  const raw = optionalText(value);
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
  } catch {
    throw new Error("Enter a valid company domain or website");
  }

  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Enter a valid HTTP or HTTPS company domain");
  }

  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!hostname || hostname.includes("..")) {
    throw new Error("Enter a valid company domain");
  }
  return hostname;
}

function normalizeUrl(value: unknown): string | null {
  const raw = optionalText(value);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
  } catch {
    throw new Error("Enter a valid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Enter a valid HTTP or HTTPS URL");
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (parsed.pathname === "/") parsed.pathname = "";
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeCompanyName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => LEGAL_TOKEN_EXPANSIONS[token] ?? token)
    .join(" ");
}

function baseNameTokens(name: string): string[] {
  const tokens = name.split(" ").filter(Boolean);
  while (tokens.length > 1 && NON_DISTINCTIVE_SUFFIXES.has(tokens.at(-1)!)) {
    tokens.pop();
  }
  return tokens;
}

export function canonicalCompanyNameKey(name: string): string {
  return baseNameTokens(normalizeCompanyName(name)).join(" ");
}

export function namesArePossibleDuplicates(left: string, right: string): boolean {
  if (!left || !right) return false;
  const leftNormalized = normalizeCompanyName(left);
  const rightNormalized = normalizeCompanyName(right);
  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized === rightNormalized) return true;

  const leftTokens = baseNameTokens(leftNormalized);
  const rightTokens = baseNameTokens(rightNormalized);
  if (
    leftTokens.join(" ") === rightTokens.join(" ") &&
    leftTokens.join("").length >= 4
  ) {
    return true;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  const shortest = Math.min(leftSet.size, rightSet.size);
  return (
    intersection > 0 &&
    (intersection / union >= 0.6 || intersection === shortest) &&
    [...leftSet].some((token) => token.length >= 4)
  );
}

export function normalizeCompanyInput(input: RawCompanyInput): {
  value: NormalizedCompanyInput | null;
  errors: string[];
} {
  const errors: string[] = [];
  const canonicalName = optionalText(input.canonicalName);
  if (!canonicalName) errors.push("Company name is required");
  if (canonicalName && canonicalName.length > 300) {
    errors.push("Company name must be 300 characters or fewer");
  }

  let domain: string | null = null;
  let website: string | null = null;
  let linkedinUrl: string | null = null;
  try {
    domain = normalizeDomain(input.domain ?? input.website);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Invalid domain");
  }
  try {
    website = normalizeUrl(input.website);
  } catch {
    errors.push("Website must be a valid URL");
  }
  try {
    linkedinUrl = normalizeUrl(input.linkedinUrl);
  } catch {
    errors.push("LinkedIn URL must be a valid URL");
  }

  let employeeCount: number | null = null;
  if (input.employeeCount !== null && input.employeeCount !== undefined && input.employeeCount !== "") {
    const parsed =
      typeof input.employeeCount === "number"
        ? input.employeeCount
        : Number(String(input.employeeCount).replace(/,/g, "").trim());
    if (!Number.isInteger(parsed) || parsed < 0) {
      errors.push("Employee count must be a non-negative whole number");
    } else {
      employeeCount = parsed;
    }
  }

  const safeOptional = (value: unknown, label: string, max: number) => {
    try {
      const result = optionalText(value);
      if (result && result.length > max) {
        errors.push(`${label} must be ${max} characters or fewer`);
      }
      return result;
    } catch {
      errors.push(`${label} must be text`);
      return null;
    }
  };

  const country = safeOptional(input.country, "Country", 120);
  const industry = safeOptional(input.industry, "Industry", 200);
  const employeeRange = safeOptional(input.employeeRange, "Employee range", 120);
  const description = safeOptional(input.description, "Description", 2000);

  if (errors.length || !canonicalName) return { value: null, errors };
  return {
    value: {
      canonicalName,
      domain,
      website: website ?? (domain ? `https://${domain}` : null),
      linkedinUrl,
      country,
      industry,
      employeeCount,
      employeeRange,
      description,
    },
    errors: [],
  };
}