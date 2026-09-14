import { countryFromPlace } from "./company-country";
import type { EvidenceItemV2 } from "./schemas";

/**
 * Where a company says it is, taken from its own pages.
 *
 * Geography was only ever claimed by the COMPANY_FIRMOGRAPHICS step, whose
 * only provider needs a LinkedIn URL the pipeline does not carry — so it
 * refused every request and headquarters came back UNKNOWN for every company
 * ever assessed. Meanwhile the first-party crawl was reading pages whose
 * footers say "Bengaluru, Karnataka 560103, India" and throwing that away.
 *
 * No model. A company's own about page stating where it is headquartered is
 * a fact, and facts are extracted deterministically here for the same reason
 * job postings and security incidents are: a model asked "where is this
 * company" will answer even when the page never said.
 *
 * Precision over recall, deliberately. A place is only claimed when it
 * resolves to a country we recognise, which throws away "based in the cloud",
 * "based on trust" and every other sentence that reads like an address and
 * is not one. Getting this wrong is worse than leaving it unknown: a wrong
 * headquarters biases every search for that company and lies in the
 * assessment.
 */

export type GeographyClaim = NonNullable<NonNullable<EvidenceItemV2["claims"]>["geography"]>[number];

/** Phrases a company uses about its own head office, most explicit first. */
const HEADQUARTERS_PATTERNS: RegExp[] = [
  /\bhead(?:\s|-)?quarter(?:ed|s)?\s+(?:in|at)\s+([^.;|\n]{3,80})/gi,
  /\bheadquarters[:\s]+([^.;|\n]{3,80})/gi,
  /\bhq\s*[:\-]\s*([^.;|\n]{3,80})/gi,
  /\b(?:registered|corporate|head)\s+office[:\s]+([^.;|\n]{3,80})/gi,
  /\bbased\s+(?:in|out\s+of)\s+([^.;|\n]{3,80})/gi,
];

/** Phrases about additional presence, which is a weaker but still useful claim. */
const OFFICE_PATTERNS: RegExp[] = [
  /\boffices?\s+(?:in|across|throughout)\s+([^.;|\n]{3,120})/gi,
  /\bpresence\s+(?:in|across)\s+([^.;|\n]{3,120})/gi,
  /\boperations?\s+(?:in|across)\s+([^.;|\n]{3,120})/gi,
];

/** Address-shaped lines, used only when nothing explicit was said. */
const ADDRESS_HINT = /\b(floor|street|st\.|road|rd\.|avenue|ave\.|tower|park|building|block|sector|suite|plot|lane|marg|nagar|phase|campus)\b/i;
const POSTCODE = /\b(\d{6}|\d{5}(-\d{4})?|[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/;

/** Words that end a place: everything after them is prose, not geography. */
const TAIL_NOISE = /\s+(?:and|with|where|which|since|to|for|we|our|the\s+company|serving|providing|offering|delivering)\b[\s\S]*$/i;

/**
 * Tidy a captured fragment into a place.
 *
 * "Bengaluru, Karnataka 560103, India and serving customers worldwide"
 * becomes "Bengaluru, Karnataka, India". Keeps at most the last three comma
 * segments that carry meaning, because a place is a city and its country,
 * not a street address.
 */
export function tidyPlace(raw: string): string | null {
  let text = raw
    .replace(/\s+/g, " ")
    .replace(TAIL_NOISE, "")
    .replace(/[\s,;:–—-]+$/, "")
    .replace(/^[\s,;:–—-]+/, "")
    .trim();
  if (!text) return null;
  // Drop postcodes; they add nothing to a place and break the country match.
  text = text.replace(POSTCODE, "").replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
  const segments = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (!segments.length) return null;
  // Keep the tail — "12th Main, Indiranagar, Bengaluru, India" is a place
  // once the street is dropped, and the country is always last.
  const kept = segments.slice(-3);
  const place = kept.join(", ");
  if (place.length < 3 || place.length > 90) return null;
  // Every word capitalised or a known place word; a sentence fragment is not
  // a place. Requiring a resolvable country below is the real filter.
  return place;
}

const claimFrom = (type: GeographyClaim["type"], fragment: string): GeographyClaim | null => {
  const place = tidyPlace(fragment);
  if (!place) return null;
  // The filter that matters: if we cannot resolve it to a country, we do not
  // claim it. "based in the cloud" dies here, and so does every false positive
  // that would otherwise bias this company's searches for good.
  if (!countryFromPlace(place)) return null;
  return { type, value: place };
};

const collect = (text: string, patterns: RegExp[], type: GeographyClaim["type"]): GeographyClaim[] => {
  const found: GeographyClaim[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const claim = claimFrom(type, match[1] ?? "");
      if (claim) found.push(claim);
    }
  }
  return found;
};

/**
 * Geography claims from one page's text. First-party pages only — a company
 * is authoritative about its own address, a press article is not.
 */
export function extractGeographyClaims(text: string, options: { maxClaims?: number } = {}): GeographyClaim[] {
  const body = (text ?? "").slice(0, 40_000);
  // Long enough to hold a place and a country; the country check below is the
  // filter that matters, so this only skips obviously empty input.
  if (body.length < 12) return [];
  const maxClaims = options.maxClaims ?? 6;

  const headquarters = collect(body, HEADQUARTERS_PATTERNS, "HEADQUARTERS");
  const offices = collect(body, OFFICE_PATTERNS, "OFFICE_PRESENCE");

  // Nothing said in words: fall back to an address block, which is how most
  // company sites actually state where they are.
  const fromAddress: GeographyClaim[] = [];
  if (!headquarters.length) {
    for (const line of body.split("\n")) {
      const candidate = line.trim();
      if (candidate.length < 12 || candidate.length > 160) continue;
      if (!ADDRESS_HINT.test(candidate) && !POSTCODE.test(candidate)) continue;
      const claim = claimFrom("HEADQUARTERS", candidate);
      if (claim) { fromAddress.push(claim); break; }
    }
  }

  const seen = new Set<string>();
  const ordered = [...headquarters, ...fromAddress, ...offices];
  const claims: GeographyClaim[] = [];
  for (const claim of ordered) {
    const key = `${claim.type}:${claim.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push(claim);
    if (claims.length >= maxClaims) break;
  }
  return claims;
}
