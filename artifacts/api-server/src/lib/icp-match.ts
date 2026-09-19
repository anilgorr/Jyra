import { countryFromPlace } from "./intelligence-v2/company-country";
import { COUNTRY_NAMES, countryIso2, industryTags, type IndustryTag } from "./company-normalization";

/**
 * Does a company match an ICP criterion?
 *
 * The vocabulary lives in `company-normalization.ts` and is shared with the
 * write path, so "what this company is" and "what this criterion asks for"
 * are decided by the same tables. This module only holds the comparison and
 * the region expansions an ICP value may use ("North America", "Middle East
 * & Asia-Pacific"), which are an ICP concept and not a company attribute.
 *
 * The rule throughout: a value neither side can place is unknown, never a
 * failure.
 */

export type MatchResult = "pass" | "fail" | "unknown";

/* Re-exported, not reimplemented: the vocabulary has one home, and ICP code
 * should not need to know which module that is. */
export { industryTags, countryIso2 } from "./company-normalization";

const tidy = (value: unknown): string => (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim();

/** Criterion values may be one string per entry or several joined by newlines. */
function criterionEntries(values: unknown): string[] {
  const list = Array.isArray(values) ? values : [values];
  return list.flatMap((item) => (typeof item === "string" ? item : "").split(/\n/)).map(tidy).filter(Boolean);
}

/**
 * Labels that name the market a software company serves, not a different
 * business from software.
 *
 * A seller targeting "saas" had eleven real prospects disqualified by their
 * vertical label alone: Okta, Wiz, Snyk, Abnormal Security and 1Password as
 * "Cybersecurity", Ramp, Alloy, Sardine, Truv and Zeta as "Fintech",
 * Innovaccer as "Healthtech". Every one of them sells software by
 * subscription and runs the sales team the seller exists to sell to. The tag
 * sets simply did not intersect, so the criterion said fail, and a failed
 * MUST_HAVE clamps Fit to 29.
 *
 * But the label does not establish the opposite either - a fintech can be a
 * lender, a healthtech can be a clinic - so "pass" would be as much of an
 * invention as "fail" was. It is genuinely unknown from a label, and this
 * system does not treat unknown as failure. The company keeps its place and
 * the question stays open for evidence that can actually answer it.
 *
 * Only technology verticals qualify. "Hotels" against "saas" is still a fail:
 * that is a different business, not a slice of the same one.
 */
const VERTICAL_TECH_TAGS: ReadonlySet<IndustryTag> = new Set<IndustryTag>(["CYBERSECURITY", "FINTECH", "HEALTHTECH", "EDTECH"]);
const SOFTWARE_TAGS: ReadonlySet<IndustryTag> = new Set<IndustryTag>(["SOFTWARE", "IT_SERVICES"]);

function verticalOfSoftware(factTags: ReadonlySet<IndustryTag>, wanted: ReadonlySet<IndustryTag>): boolean {
  if (![...wanted].some((tag) => SOFTWARE_TAGS.has(tag))) return false;
  if ([...factTags].some((tag) => SOFTWARE_TAGS.has(tag))) return false;
  return [...factTags].some((tag) => VERTICAL_TECH_TAGS.has(tag));
}

export function industryMatch(fact: unknown, criterionValues: unknown): MatchResult {
  const factText = tidy(fact);
  if (!factText) return "unknown";
  const entries = criterionEntries(criterionValues);
  if (!entries.length) return "unknown";
  const factLower = factText.toLowerCase();
  if (entries.some((entry) => entry.toLowerCase() === factLower)) return "pass";
  const factTags = industryTags(factText);
  const wanted = new Set<IndustryTag>();
  for (const entry of entries) for (const tag of industryTags(entry)) wanted.add(tag);
  if (!wanted.size || !factTags.size) return "unknown";
  for (const tag of factTags) if (wanted.has(tag)) return "pass";
  if (verticalOfSoftware(factTags, wanted)) return "unknown";
  return "fail";
}

/** The same comparison, against tags already stored on the row. */
export function industryMatchFromTags(tags: readonly string[] | null | undefined, criterionValues: unknown): MatchResult {
  if (!tags?.length) return "unknown";
  const entries = criterionEntries(criterionValues);
  if (!entries.length) return "unknown";
  const wanted = new Set<IndustryTag>();
  for (const entry of entries) for (const tag of industryTags(entry)) wanted.add(tag);
  if (!wanted.size) return "unknown";
  if (tags.some((tag) => wanted.has(tag as IndustryTag))) return "pass";
  if (verticalOfSoftware(new Set(tags as IndustryTag[]), wanted)) return "unknown";
  return "fail";
}

/* ---------------------------------------------------------------- geography */

const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
const NORDICS = ["SE", "NO", "DK", "FI", "IS"];
const DACH = ["DE", "AT", "CH"];
const BENELUX = ["BE", "NL", "LU"];
const EUROPE = [...new Set([...EU, ...NORDICS, ...DACH, "GB", "IS", "UA", "RS", "TR"])];
const GCC = ["AE", "SA", "QA", "BH", "OM", "KW"];
const MIDDLE_EAST = [...GCC, "IL", "JO", "LB", "IQ", "EG", "TR"];
const SOUTHEAST_ASIA = ["SG", "MY", "ID", "PH", "TH", "VN"];
const SOUTH_ASIA = ["IN", "PK", "BD", "LK", "NP"];
const EAST_ASIA = ["JP", "KR", "CN", "HK", "TW"];
const ANZ = ["AU", "NZ"];
const APAC = [...SOUTH_ASIA, ...SOUTHEAST_ASIA, ...EAST_ASIA, ...ANZ];
const WESTERN_EUROPE = ["FR", "BE", "NL", "LU", "IE", "GB", "DE", "AT", "CH", "MC"];
const SOUTHERN_EUROPE = ["ES", "PT", "IT", "GR", "MT", "CY", "HR", "SI", "RS", "AL"];
const EASTERN_EUROPE = ["PL", "CZ", "SK", "HU", "RO", "BG", "UA", "EE", "LV", "LT"];
const CENTRAL_EUROPE = ["DE", "AT", "CH", "PL", "CZ", "SK", "HU", "SI"];
const NORTH_AMERICA = ["US", "CA", "MX"];
const LATAM = ["MX", "BR", "AR", "CL", "CO", "PE"];
const AFRICA = ["ZA", "NG", "KE", "EG", "GH", "TZ", "MA"];

const REGIONS: Array<[RegExp, string[]]> = [
  [/^(?:global|worldwide|international|anywhere|any|all)$/i, ["*"]],
  [/^(?:north america|na|us\s*(?:&|and|\+|\/)\s*canada|usa\s*(?:&|and|\+|\/)\s*canada)$/i, NORTH_AMERICA],
  [/^(?:european union|eu)$/i, EU],
  [/^(?:europe|emea)$/i, EUROPE],
  [/^west(?:ern)? europe$/i, WESTERN_EUROPE],
  [/^south(?:ern)? europe$/i, SOUTHERN_EUROPE],
  [/^east(?:ern)? europe$/i, EASTERN_EUROPE],
  [/^central europe$/i, CENTRAL_EUROPE],
  [/^(?:nordics?|scandinavia)$/i, NORDICS],
  [/^dach$/i, DACH],
  [/^benelux$/i, BENELUX],
  [/^(?:middle east|mena|me)$/i, MIDDLE_EAST],
  [/^(?:gcc|gulf|gulf countries)$/i, GCC],
  [/^(?:asia[- ]pacific|apac|asia)$/i, APAC],
  [/^(?:south[- ]?east asia|sea|asean)$/i, SOUTHEAST_ASIA],
  [/^(?:south asia|indian subcontinent)$/i, SOUTH_ASIA],
  [/^(?:east asia)$/i, EAST_ASIA],
  [/^(?:anz|australia\s*(?:&|and|\+|\/)\s*new zealand|oceania|australasia)$/i, ANZ],
  [/^(?:latin america|latam|south america)$/i, LATAM],
  [/^(?:africa|sub-saharan africa)$/i, AFRICA],
];

const KNOWN_CODES = new Set([...Object.values(COUNTRY_NAMES), ...EUROPE, ...WESTERN_EUROPE, ...SOUTHERN_EUROPE, ...EASTERN_EUROPE, ...APAC, ...MIDDLE_EAST, ...LATAM, ...AFRICA, "RU"]);

/** A compass qualifier with nothing to qualify, as in "Western and Southern Europe". */
const BARE_QUALIFIER = /^(?:north|south|east|west|central)(?:ern)?$/i;

/**
 * "Western and Southern Europe" splits on the conjunction into "Western" and
 * "Southern Europe". The first half means nothing alone and would silently
 * drop a French or Dutch company, so it borrows the noun from a later part.
 */
function completeQualifiers(parts: string[]): string[] {
  return parts.map((part, index) => {
    if (!BARE_QUALIFIER.test(part)) return part;
    for (let next = index + 1; next < parts.length; next += 1) {
      const [, ...noun] = parts[next].split(" ");
      if (noun.length) return `${part} ${noun.join(" ")}`;
    }
    return part;
  });
}

/** The ISO codes an ICP value stands for; "*" means anywhere. Empty = not understood. */
export function geographyCodes(value: unknown): Set<string> {
  const out = new Set<string>();
  const parts = criterionEntries(value).flatMap((entry) =>
    completeQualifiers(
      entry.split(/\s*(?:,|;|\/|\+|&|\band\b)\s*/i).map((part) => part.trim().replace(/[.]/g, "")).filter(Boolean),
    ),
  );
  for (const part of parts) {
    const region = REGIONS.find(([pattern]) => pattern.test(part));
    if (region) { for (const code of region[1]) out.add(code); continue; }
    const country = COUNTRY_NAMES[part.toLowerCase()];
    if (country) { out.add(country); continue; }
    if (/^[A-Za-z]{2}$/.test(part) && KNOWN_CODES.has(part.toUpperCase())) { out.add(part.toUpperCase()); continue; }
    const placed = countryFromPlace(part);
    if (placed) out.add(placed);
  }
  return out;
}

/** The ISO code a stored country / headquarters value stands for, or null. */
export const factCountry = countryIso2;

export function geographyMatch(fact: unknown, criterionValues: unknown): MatchResult {
  const code = factCountry(fact);
  if (!code) return "unknown";
  const wanted = geographyCodes(criterionValues);
  if (!wanted.size) return "unknown";
  return wanted.has("*") || wanted.has(code) ? "pass" : "fail";
}

export function invertMatch(result: MatchResult): MatchResult {
  return result === "pass" ? "fail" : result === "fail" ? "pass" : "unknown";
}
