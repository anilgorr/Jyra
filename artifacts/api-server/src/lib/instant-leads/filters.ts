import { all, any, condition, type CrustdataFilter } from "./crustdata-client";
import { CRUSTDATA_HEADCOUNT_RANGES } from "./crustdata-vocabulary";
import { resolveGeography } from "./geography";
import { resolveIndustries } from "./industries";

/**
 * The ICP and the signal pack, as a Crustdata query.
 *
 * Two halves, AND-ed together. The firmographic half comes from the ICP
 * criteria the customer accepted: size, where, which industries. The
 * activity half comes from the active pack's positive definitions, OR-ed:
 * a company qualifies as a candidate if it recently did any of the things
 * the seller cares about. Crustdata can only see some of those things
 * (headcount and role growth, funding dates, open roles); the rest - a new
 * CMO, a certification - it cannot, so a LEADERSHIP rule becomes a growth
 * proxy here and the research cycle is what confirms or denies it.
 *
 * Every mapping is a pure function of its inputs and everything that could
 * not be honoured is reported, because the admin needs to see "Edtech
 * mapped, 'Niche Vertical X' did not" before the customer wonders why.
 */

export type IcpCriterionInput = { dimension: string; operator: string; value: unknown; accepted: boolean };
export type PackDefinitionInput = {
  code: string;
  category: string;
  polarity: "POSITIVE" | "NEGATIVE";
  factTypes: string[];
  matchAny: string[];
  lifetimeDays: number;
};

export type ActivityCondition = { code: string; field: string; type: string; value: unknown; rationale: string };

export type InstantLeadFilterPlan = {
  filters: CrustdataFilter;
  firmographic: CrustdataFilter[];
  activity: ActivityCondition[];
  sorts: Array<{ field: string; order: "asc" | "desc" }>;
  resolved: {
    headcount: { min: number | null; max: number | null };
    countries: string[];
    cities: Array<{ city: string; country: string }>;
    industries: string[];
    industryMapping: Array<{ label: string; industries: string[] }>;
  };
  unmapped: { industries: string[]; geographies: string[] };
  /** Pack definitions that produced no condition, with the reason. */
  skippedDefinitions: Array<{ code: string; reason: string }>;
};

/** Crustdata's role-distribution keys; a pack keyword has to land on one of these to become a role-growth condition. */
export const CRUSTDATA_ROLE_FUNCTIONS = [
  "accounting", "administrative", "arts_and_design", "business_development", "community_and_social_services", "consulting",
  "customer_success_and_support", "education", "engineering", "entrepreneurship", "finance", "healthcare_services", "human_resources",
  "information_technology", "legal", "marketing", "media_and_communication", "military_and_protective_services", "operations",
  "product_management", "program_and_project_management", "purchasing", "quality_assurance", "real_estate", "research", "sales", "support",
] as const;

/** Words a pack uses, to the function whose growth they imply. First match in a definition's keywords wins. */
const KEYWORD_FUNCTIONS: Array<[RegExp, (typeof CRUSTDATA_ROLE_FUNCTIONS)[number]]> = [
  [/\b(sales|sdr|bdr|account executive|presales|pre-sales|revenue|partner|channel)\b/i, "sales"],
  [/\b(business development)\b/i, "business_development"],
  [/\b(marketing|growth|demand generation|brand|cmo|seo|content|performance)\b/i, "marketing"],
  [/\b(customer success|csm|support)\b/i, "customer_success_and_support"],
  [/\b(security|soc|cyber|devops|infrastructure|sre|platform|data|engineer|engineering|developer|cloud|iam|siem|endpoint)\b/i, "engineering"],
  [/\b(it|information technology|systems|erp|business systems|enterprise applications)\b/i, "information_technology"],
  [/\b(finance|accounting|controller|cfo)\b/i, "finance"],
  [/\b(hr|people|talent|recruit)\b/i, "human_resources"],
  [/\b(operations|facilities|plant|supply chain|logistics)\b/i, "operations"],
  [/\b(product)\b/i, "product_management"],
  [/\b(legal|compliance)\b/i, "legal"],
  [/\b(research|r&d|scientist)\b/i, "research"],
];

export function roleFunctionFor(keywords: string[]): (typeof CRUSTDATA_ROLE_FUNCTIONS)[number] | null {
  for (const keyword of keywords) {
    for (const [pattern, fn] of KEYWORD_FUNCTIONS) if (pattern.test(keyword)) return fn;
  }
  return null;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

const number = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value.replace(/,/g, "")) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};
const listValue = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).flatMap((item) => item.split(/[,;\n]/)).map((s) => s.trim()).filter(Boolean)
    : typeof value === "string" ? value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean) : [];

/**
 * One pack definition into (at most) one Crustdata condition.
 *
 * HIRING rules: role growth in the function the keywords name, else "has
 * open roles" when the keywords name no function Crustdata tracks.
 * FUNDING: a round since the rule's lifetime. EXPANSION: six-month headcount
 * growth. LEADERSHIP: three-month headcount growth as a weak proxy - a
 * reorganising company is more likely to have a new leader, and research
 * decides. TECHNOLOGY/COMPLIANCE/CUSTOMER/NEGATIVE: nothing Crustdata can
 * filter on; skipped and reported.
 */
/** The employee-count buckets Crustdata indexes, with their numeric edges. "myself only" is 1. */
const HEADCOUNT_BUCKET_EDGES: Array<{ label: (typeof CRUSTDATA_HEADCOUNT_RANGES)[number]; min: number; max: number }> = [
  { label: "myself only", min: 1, max: 1 }, { label: "2-10", min: 2, max: 10 }, { label: "11-50", min: 11, max: 50 }, { label: "51-200", min: 51, max: 200 },
  { label: "201-500", min: 201, max: 500 }, { label: "501-1000", min: 501, max: 1000 }, { label: "1001-5000", min: 1001, max: 5000 },
  { label: "5001-10000", min: 5001, max: 10000 }, { label: "10001+", min: 10001, max: Number.POSITIVE_INFINITY },
];

/** Every bucket that overlaps [min, max]; both bounds optional. */
export function headcountBucketsFor(min: number | null, max: number | null): string[] {
  if (min === null && max === null) return [];
  const lo = min ?? 0; const hi = max ?? Number.POSITIVE_INFINITY;
  return HEADCOUNT_BUCKET_EDGES.filter((bucket) => bucket.max >= lo && bucket.min <= hi).map((bucket) => bucket.label);
}

/** The lower edge of a bucket label, for a headcount when the premium total is not requested. */
export function headcountFromRange(label: string | null | undefined): number | null {
  const bucket = HEADCOUNT_BUCKET_EDGES.find((item) => item.label === (label ?? "").trim());
  return bucket ? bucket.min : null;
}

export function activityConditionFor(definition: PackDefinitionInput, now: Date): ActivityCondition | { skipped: string } {
  if (definition.polarity === "NEGATIVE") return { skipped: "negative rules are applied by research, not by search" };
  const types = new Set(definition.factTypes.map((type) => type.toUpperCase()));
  const lifetime = Math.max(30, Math.min(365, Math.round(definition.lifetimeDays || 90)));
  if (types.has("FUNDING_EVENT")) {
    return { code: definition.code, field: "funding.last_fundraise_date", type: "=>", value: isoDate(daysAgo(now, lifetime)), rationale: `raised a round in the last ${lifetime} days` };
  }
  if (types.has("JOB_OPENING") || types.has("HIRING_COUNT") || types.has("EMPLOYEE_GROWTH")) {
    const fn = roleFunctionFor(definition.matchAny);
    // Per-function growth is documented as `roles.growth_yoy.<function>` with `=>`; the six-month form is not.
    if (fn) return { code: definition.code, field: `roles.growth_yoy.${fn}`, type: "=>", value: 20, rationale: `${fn.replace(/_/g, " ")} team grew 20%+ in the last year` };
    return { code: definition.code, field: "hiring.openings_count", type: "=>", value: 1, rationale: "has open roles" };
  }
  if (types.has("COMPANY_EXPANSION") || types.has("NEW_MARKET")) {
    return { code: definition.code, field: "headcount.growth_percent.6m", type: ">", value: 15, rationale: "headcount up more than 15% in six months" };
  }
  if (types.has("LEADERSHIP_CHANGE")) {
    return { code: definition.code, field: "headcount.growth_percent.3m", type: ">", value: 5, rationale: "headcount up more than 5% in three months (a proxy; research confirms the leadership change)" };
  }
  if (types.has("ACQUISITION")) {
    return { code: definition.code, field: "headcount.growth_percent.6m", type: ">", value: 25, rationale: "headcount up more than 25% in six months (a proxy for an acquisition)" };
  }
  return { skipped: `Crustdata cannot filter on ${[...types].join("/")}; research applies this rule` };
}

export function buildInstantLeadFilters(input: {
  criteria: IcpCriterionInput[];
  definitions: PackDefinitionInput[];
  now?: Date;
  /** Domains to leave out: already on the board, or delivered before. Crustdata has no "not in domains" at scale, so this is applied after the fetch; kept here so the plan says what will be dropped. */
  excludeDomains?: string[];
}): InstantLeadFilterPlan {
  const now = input.now ?? new Date();
  const accepted = input.criteria.filter((criterion) => criterion.accepted);
  const firmographic: CrustdataFilter[] = [];

  // Size
  let min: number | null = null; let max: number | null = null;
  for (const criterion of accepted.filter((item) => item.dimension === "employee_count")) {
    const value = criterion.value as { min?: unknown; max?: unknown } | number | string | null;
    const operator = criterion.operator.toUpperCase();
    if (value && typeof value === "object") { min = number(value.min) ?? min; max = number(value.max) ?? max; }
    else if (operator.startsWith("GT") || operator === ">=" || operator === ">") min = number(value) ?? min;
    else if (operator.startsWith("LT") || operator === "<=" || operator === "<") max = number(value) ?? max;
  }
  // `basic_info.employee_count_range` is a free basic field; `headcount.total` is a premium group billed per result
  // on the filter side (and only accepts bucket edges anyway). The buckets that overlap the ICP's range are the filter.
  const buckets = headcountBucketsFor(min, max);
  if (buckets.length && buckets.length < CRUSTDATA_HEADCOUNT_RANGES.length) firmographic.push(condition("basic_info.employee_count_range", "in", buckets));

  // Where
  const geography = resolveGeography(accepted.filter((item) => item.dimension === "geography").flatMap((item) => listValue(item.value)));
  if (geography.countries.length) firmographic.push(condition("locations.country", "in", geography.countries));
  // A named city narrows within its country; several cities are OR-ed with the country list already covering them.
  if (geography.cities.length && geography.cities.length === geography.countries.length) {
    firmographic.push(condition("locations.city", "in", geography.cities.map((city) => city.city)));
  }

  // Which industries
  const industries = resolveIndustries(accepted.filter((item) => item.dimension === "industry").flatMap((item) => listValue(item.value)));
  if (industries.industries.length) firmographic.push(condition("basic_info.industries", "in", industries.industries));

  // What they did lately
  const activity: ActivityCondition[] = [];
  const skippedDefinitions: InstantLeadFilterPlan["skippedDefinitions"] = [];
  const seenFields = new Set<string>();
  for (const definition of input.definitions) {
    const mapped = activityConditionFor(definition, now);
    if ("skipped" in mapped) { skippedDefinitions.push({ code: definition.code, reason: mapped.skipped }); continue; }
    const key = `${mapped.field}|${mapped.type}|${JSON.stringify(mapped.value)}`;
    if (seenFields.has(key)) { skippedDefinitions.push({ code: definition.code, reason: `same condition as another rule (${mapped.field})` }); continue; }
    seenFields.add(key);
    activity.push(mapped);
  }

  const filters = activity.length
    ? all(...firmographic, any(...activity.map((item) => condition(item.field, item.type, item.value))))
    : all(...firmographic);

  return {
    filters,
    firmographic,
    activity,
    // Growth fields are filterable but not sortable; a sort is needed for stable pagination and sorting is free.
    sorts: [{ field: "headcount.total", order: "desc" }],
    resolved: {
      headcount: { min, max }, countries: geography.countries, cities: geography.cities,
      industries: industries.industries, industryMapping: industries.mapping,
    },
    unmapped: { industries: industries.unmapped, geographies: geography.unmapped },
    skippedDefinitions,
  };
}

/**
 * The one widening pass, when the first search comes back short: drop the
 * activity group's thresholds to "any movement" and drop the city pin. The
 * firmographics - size, country, industry - never widen; a wrong market is
 * worse than a short list.
 */
export function widenInstantLeadFilters(plan: InstantLeadFilterPlan): InstantLeadFilterPlan {
  const activity = plan.activity.map((item) => {
    if (item.field.startsWith("headcount.growth_percent")) return { ...item, value: 0, rationale: `${item.rationale} (widened to any growth)` };
    return item;
  });
  const firmographic = plan.firmographic.filter((item) => !("field" in item && item.field === "locations.city"));
  const filters = activity.length
    ? all(...firmographic, any(...activity.map((item) => condition(item.field, item.type, item.value))))
    : all(...firmographic);
  return { ...plan, filters, firmographic, activity };
}

/** Drop one field from a plan - for a provider that refuses a field name - and rebuild the query. */
export function withoutField(plan: InstantLeadFilterPlan, field: string): InstantLeadFilterPlan {
  const activity = plan.activity.filter((item) => item.field !== field);
  const firmographic = plan.firmographic.filter((item) => !("field" in item && item.field === field));
  const filters = activity.length
    ? all(...firmographic, any(...activity.map((item) => condition(item.field, item.type, item.value))))
    : all(...firmographic);
  return {
    ...plan, filters, firmographic, activity,
    skippedDefinitions: [...plan.skippedDefinitions, ...plan.activity.filter((item) => item.field === field).map((item) => ({ code: item.code, reason: `provider refused field ${field}` }))],
  };
}

/** Plain words for the ICP card: what this run will look for. */
export function describeFilterPlan(plan: InstantLeadFilterPlan, labels: { country: (iso3: string) => string }): string[] {
  const parts: string[] = [];
  const { min, max } = plan.resolved.headcount;
  if (min !== null || max !== null) parts.push(`${min ?? "any"}–${max ?? "any"} employees`);
  if (plan.resolved.cities.length) parts.push(plan.resolved.cities.map((city) => city.city).join(", "));
  else if (plan.resolved.countries.length) parts.push(plan.resolved.countries.map(labels.country).join(", "));
  if (plan.resolved.industries.length) parts.push(`${plan.resolved.industryMapping.length} industr${plan.resolved.industryMapping.length === 1 ? "y" : "ies"}`);
  if (plan.activity.length) parts.push(`looking for: ${plan.activity.map((item) => item.rationale.replace(/ \(.*\)$/, "")).join("; ")}`);
  return parts;
}
