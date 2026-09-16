/**
 * Deciding which of a bought list is worth paying to watch.
 *
 * An upload lands in `screening`, where it costs nothing. Promotion into the
 * watched pool is what the plan charges for, and the pool is much smaller than
 * the list: on the first real import, 790 companies held against 107 free
 * slots. Something has to choose, and until now nothing did — the promote
 * endpoint took ids and had no opinion about which.
 *
 * Signal strength cannot be that opinion. All 142 martech signals from the
 * first import carry identical strength, 69.6, because they share a definition,
 * a default and an observation date. Ranking by it is a coin toss wearing a
 * number. So the ranking is built from the facts underneath the signals and
 * from the firmographics that arrived with them, both free.
 *
 * The policy comes from the project's own business twin rather than from
 * constants here. The twin already states what the seller sells, who it sells
 * to, what sizes and geographies it targets, and which prospects it considers
 * bad — that is the product's model of the seller, and a screen that disagreed
 * with it would be a second, secret ICP.
 *
 * Two kinds of verdict, deliberately separate. A DISQUALIFIED company is one
 * the seller should not be watching at all: it sells what the seller sells, or
 * it has no domain and therefore cannot be watched by anything. A KEEP company
 * is ranked, and the rank decides who gets a slot. Nothing here archives or
 * promotes anything; it only decides, so the numbers can be looked at before
 * they are acted on.
 */

import {
  detectOfferingOverlapV2,
  type SellerOfferingV2,
} from "./offering-overlap";
import type { TechnologyCategory } from "./vendor-technographics";

export type ScreeningCompany = {
  projectCompanyId: string;
  companyId: string;
  canonicalName: string;
  domain: string | null;
  industry: string | null;
  country: string | null;
  employeeRange: string | null;
  description: string | null;
};

export type ScreeningTechnology = {
  product: string;
  categories: readonly TechnologyCategory[];
};

export type ScreeningInput = {
  company: ScreeningCompany;
  technologies: readonly ScreeningTechnology[];
  activeSignals: number;
};

export type ScreeningPolicy = {
  /** What the seller sells, for overlap detection. */
  offering: SellerOfferingV2;
  /** Countries the seller targets, lowercased. Empty means anywhere. */
  targetCountries: readonly string[];
  /** Industries the seller itself is in — a company in one is a peer, not a buyer. */
  sellerIndustries: readonly string[];
};

export type ScreeningVerdict = "DISQUALIFIED" | "KEEP";

export type ScreeningResult = {
  projectCompanyId: string;
  companyId: string;
  canonicalName: string;
  verdict: ScreeningVerdict;
  /** Why it was disqualified. Empty on KEEP. */
  disqualifiers: string[];
  /** 0-100. Meaningless on DISQUALIFIED, where it is always 0. */
  score: number;
  /** What earned the score, in the order it was earned. For the UI and for arguing with. */
  reasons: string[];
};

/* ------------------------------------------------------------------ *
 * Policy, read from the business twin
 * ------------------------------------------------------------------ */

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/**
 * Service names, split out of the twin's compound labels.
 *
 * The overlap detector wants short phrases: it requires a multi-word phrase to
 * appear whole, or ALL of its distinctive tokens to co-occur inside one
 * sentence. Hand it a sentence and it matches nothing — feeding it the twin's
 * `differentiators` ("A single integrated playbook covering SEO, AEO, and GEO
 * instead of fragmented or channel-siloed tactics") found no competitors at all,
 * including an agency whose own description reads "web design, SEO, PPC, social
 * media".
 *
 * So the phrases come from the twin's short descriptors, split on the
 * separators it actually writes them with: "SEO & digital marketing" is two
 * services, not one, and only the split form matches a firm that calls itself a
 * digital marketing agency.
 */
function serviceNames(values: readonly string[]): string[] {
  const names: string[] = [];
  for (const value of values) {
    for (const part of value.split(/[&/,;|\n]| and /i)) {
      const phrase = part.replace(/\s+/g, " ").trim().replace(/[.)\]]+$/, "");
      // Two to four words, or a known short acronym. Anything longer is a
      // sentence and would never match; anything shorter is a generic noun.
      const words = phrase.split(" ").filter(Boolean);
      if (!words.length) continue;
      if (words.length === 1 && phrase.length > 5) continue;
      if (words.length > 4) continue;
      names.push(phrase);
    }
  }
  return [...new Set(names)];
}

/**
 * A seller offering the overlap detector can use.
 *
 * The seller's own stated industry and the offering's name — nothing else.
 *
 * The twin's `industries` array is the obvious source and the wrong one: it
 * holds the seller's industry first and then its TARGET industries. Feeding it
 * whole produced the phrases "Indian SaaS" and "fintech companies", so a
 * fintech that described itself plainly would have been dropped as a
 * competitor. Nothing was actually lost on the first import — all 37 matches
 * came from "digital marketing" — but it would have been a disqualifier built
 * out of the list of people the seller most wants to reach, and the failure
 * would have looked like the screen working.
 *
 * The prose summary still travels as `description`, where a person reads it
 * rather than a regex matching it.
 */
export function sellerOfferingFromBusinessTwin(input: {
  /** The twin's ai_interpretation, for the offering summary and name. */
  interpretation: Record<string, unknown> | null | undefined;
  /** What the seller says its OWN industry is — never the target list. */
  sellerIndustry: string | null | undefined;
  companyName?: string | null;
}): SellerOfferingV2 | null {
  const interpretation = input.interpretation ?? null;
  const summary = typeof interpretation?.offering_summary === "string"
    ? interpretation.offering_summary
    : null;
  const labels = [
    ...(input.sellerIndustry ? [input.sellerIndustry] : []),
    ...(typeof interpretation?.offering_name === "string" ? [interpretation.offering_name] : []),
  ];
  const capabilities = serviceNames(labels);
  if (!summary && !capabilities.length) return null;
  return {
    name: input.companyName ?? null,
    description: summary,
    materialCapabilities: capabilities,
  };
}

/**
 * Countries the seller's own customers are IN, lowercased.
 *
 * Deliberately literal. A twin's geography list mixes where customers are with
 * who they sell to — "Indian brands targeting US and UK markets", "GCC-based
 * companies serving Indian audiences", "Global SaaS companies targeting Indian
 * users". Only a line naming a country plainly counts; reading the others as
 * target countries would hand a bonus to every American company on the list on
 * the strength of a sentence about Indian brands.
 */
export function targetCountriesFromBusinessTwin(
  interpretation: Record<string, unknown> | null | undefined,
): string[] {
  const geographies = asStrings(interpretation?.geographies).map((entry) => entry.toLowerCase());
  const known = [
    "india", "united states", "united kingdom", "singapore", "australia", "canada",
    "united arab emirates", "germany", "france", "netherlands", "ireland",
  ];
  return known.filter((country) => geographies.some((entry) => entry.includes(country)));
}

/**
 * One spelling for a country, whatever the source wrote.
 *
 * The same field arrives as "India", "IN", "US" and "United States" from
 * different importers and providers, and comparing raw strings meant every
 * company recorded as "IN" scored zero on geography — not because it was
 * abroad, but because of the spelling. A screen that silently mismarks its own
 * target market is worse than one with no geography rule at all.
 */
export function normalizeCountry(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const ALIASES: Record<string, string> = {
    in: "india", ind: "india", bharat: "india",
    us: "united states", usa: "united states", "u.s.": "united states",
    "u.s.a.": "united states", america: "united states",
    uk: "united kingdom", gb: "united kingdom", gbr: "united kingdom",
    "great britain": "united kingdom", england: "united kingdom",
    ae: "united arab emirates", uae: "united arab emirates",
    sg: "singapore", au: "australia", ca: "canada", de: "germany",
    fr: "france", nl: "netherlands", ie: "ireland",
  };
  return ALIASES[raw] ?? raw;
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

/** Categories a buyer spends real money on, as opposed to page furniture. */
const COMMERCIAL_CATEGORIES: readonly TechnologyCategory[] = [
  "crm",
  "marketing automation",
  "advertising",
  "analytics",
  "ecommerce",
  "customer support",
  "applicant tracking",
];

/**
 * Products that mean a budget and somebody whose job it is to run them.
 *
 * Deliberately short. The point is not to enumerate enterprise software, it is
 * to separate "has a mailing list" from "has a marketing operations function".
 * Mailchimp and Zoho are not on it for exactly that reason.
 */
const ENTERPRISE_TIER = new Set([
  "Marketo", "Pardot", "Eloqua", "Salesforce", "Adobe Analytics", "Adobe Target",
  "Adobe Experience Manager", "SAP SuccessFactors", "NetSuite", "Sitecore",
  "Demandware", "The Trade Desk", "MediaMath", "Tealium", "Segment", "Optimizely",
  "LiveRamp", "Taleo", "iCIMS", "Cornerstone OnDemand", "Demandbase", "Bizible",
]);

export function screenCompany(input: ScreeningInput, policy: ScreeningPolicy): ScreeningResult {
  const { company } = input;
  const disqualifiers: string[] = [];

  /* No domain, no watching. The change gate hashes pages under a domain and
   * every free reader needs one; a company with only a name can be stored and
   * contacted but never observed, so a watch slot spent on it buys nothing. */
  if (!company.domain) disqualifiers.push("No domain — nothing to watch");

  /* Sells what the seller sells. The detector reads the company's own words:
   * its description first, then its name, because an agency usually says so in
   * one or the other. On the first real import this caught 51 of 790, eleven of
   * which were already carrying an active signal — signals pointing at
   * competitors, which is worse than no signal at all. */
  const ownWords = [company.description, company.canonicalName].filter(Boolean).join(". ");
  const overlap = detectOfferingOverlapV2(ownWords, policy.offering);
  if (overlap.length) {
    disqualifiers.push(`Sells what you sell: "${overlap[0]!.phrase}"`);
  }

  if (
    company.industry &&
    policy.sellerIndustries.some(
      (industry) => industry.toLowerCase() === company.industry!.toLowerCase(),
    )
  ) {
    disqualifiers.push(`Same industry as you: ${company.industry}`);
  }

  /* No size ceiling, and the reason is worth recording so nobody adds one
   * from the armchair.
   *
   * The obvious rule — disqualify the giants — has nothing to run on. Not one
   * of the 808 companies carries a headcount; `employee_count` is null across
   * the board, and the vendor's `employee_range` is a four-label band
   * ("Medium Enterprise") whose thresholds nobody has published.
   *
   * The next idea, reading the company's own words, was tried and measured:
   * matching "conglomerate", "Fortune 500" and the like flagged 45 companies,
   * and every one was a small Indian IT services firm advertising its
   * CLIENTS — Greysoft, a Growing Startup; Neova Solutions, an Emerging
   * Business. It caught none of the actual giants, because Xiaomi India and
   * Mahindra Group arrived with no description at all. A hundred per cent
   * false positives, zero true ones, and it would have deleted good prospects
   * for boasting about their customers.
   *
   * The giants at the top of the first ranked list turned out not to be a size
   * problem anyway. They were empty records — name and domain, no facts, no
   * signals — scoring on Fit alone. Weighting evidence properly drops them
   * without anyone having to guess at headcounts. */

  if (disqualifiers.length) {
    return {
      projectCompanyId: company.projectCompanyId,
      companyId: company.companyId,
      canonicalName: company.canonicalName,
      verdict: "DISQUALIFIED",
      disqualifiers,
      score: 0,
      reasons: [],
    };
  }

  const reasons: string[] = [];
  let score = 0;

  if (input.activeSignals > 0) {
    score += 35;
    reasons.push(
      `${input.activeSignals} active signal${input.activeSignals === 1 ? "" : "s"}`,
    );
  }

  /* Breadth, then redundancy. A company running one commercial product has
   * bought something; a company running four has a stack. A company running two
   * products in the SAME category — HubSpot and Marketo, say — has an overlap
   * it is paying for twice, which is a conversation rather than a guess. */
  const byCategory = new Map<TechnologyCategory, string[]>();
  for (const technology of input.technologies) {
    for (const category of technology.categories) {
      if (!COMMERCIAL_CATEGORIES.includes(category)) continue;
      byCategory.set(category, [...(byCategory.get(category) ?? []), technology.product]);
    }
  }
  const breadth = byCategory.size;
  if (breadth) {
    score += Math.min(25, breadth * 8);
    reasons.push(`${breadth} commercial software categor${breadth === 1 ? "y" : "ies"}`);
  }

  const doubledUp = [...byCategory.entries()].filter(([, products]) => products.length > 1);
  if (doubledUp.length) {
    score += 12;
    const [category, products] = doubledUp[0]!;
    reasons.push(`Two ${category} tools: ${[...new Set(products)].join(" and ")}`);
  }

  const enterprise = input.technologies
    .map((technology) => technology.product)
    .filter((product) => ENTERPRISE_TIER.has(product));
  if (enterprise.length) {
    score += 18;
    reasons.push(`Runs ${[...new Set(enterprise)].join(", ")} — a real budget`);
  }

  /* Geography last, and only ever as a bonus. The twin names target countries,
   * but 82 of the 790 imported companies have no country at all, and scoring a
   * missing value as a miss would rank a company down for a gap in the file
   * rather than a fact about the company. */
  const country = normalizeCountry(company.country);
  if (policy.targetCountries.length && country) {
    if (policy.targetCountries.includes(country)) {
      score += 10;
      reasons.push(`In ${company.country}, a market you sell to`);
    }
  }

  return {
    projectCompanyId: company.projectCompanyId,
    companyId: company.companyId,
    canonicalName: company.canonicalName,
    verdict: "KEEP",
    disqualifiers: [],
    score: Math.min(100, score),
    reasons,
  };
}

export type ScreeningReport = {
  considered: number;
  disqualified: ScreeningResult[];
  /** KEEP results, best first. Ties broken by name so the order is stable. */
  ranked: ScreeningResult[];
};

export function screenCompanies(
  inputs: readonly ScreeningInput[],
  policy: ScreeningPolicy,
): ScreeningReport {
  const results = inputs.map((input) => screenCompany(input, policy));
  return {
    considered: inputs.length,
    disqualified: results.filter((result) => result.verdict === "DISQUALIFIED"),
    ranked: results
      .filter((result) => result.verdict === "KEEP")
      .sort((left, right) =>
        right.score - left.score || left.canonicalName.localeCompare(right.canonicalName),
      ),
  };
}
