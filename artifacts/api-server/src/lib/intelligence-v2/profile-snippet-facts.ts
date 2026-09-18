import type { GeographyClaim } from "./geography-facts";

/**
 * Industry, headcount and headquarters from a LinkedIn company-page snippet.
 *
 * The firmographics provider that was supposed to supply INDUSTRY and
 * EMPLOYEE_SIZE claims has refused every request the pipeline has made -
 * 136 of 136 in the first four days. With no INDUSTRY claim it is allowed to
 * cite, the model asked "is this company in IT?" has two choices: abstain, or
 * invent a claim ID. It invented one for Jumio, Technovert and Space-O, the
 * safety rule discarded every criterion, and the three companies in the pool
 * with real sales-hiring events had no Fit and so no score.
 *
 * Meanwhile the search step already returns the LinkedIn snippet, which for a
 * company page has a fixed shape:
 *
 *   "Website: http://www.jumio.com. External link for Jumio Corporation ;
 *    Industry: Software Development ; Company size: 201-500 employees ;
 *    Headquarters: Sunnyvale, ..."
 *
 * Reading the three labelled fields out of it is deterministic, free, and
 * gives the model something true to cite. Nothing here is inferred: a field
 * that is not literally labelled in the snippet is not claimed.
 */
export type ProfileSnippetClaims = {
  industry?: string;
  employeeSize?: string;
  geography?: GeographyClaim[];
};

const LINKEDIN_COMPANY = /^(?:[a-z]{2,3}\.)?linkedin\.com$/i;

export function isLinkedInCompanyUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return LINKEDIN_COMPANY.test(parsed.hostname.replace(/^www\./, "")) && /^\/company\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

/* Each field ends at the next " ; " separator, an ellipsis, the next
 * capitalised label, or the end of the text. Values are capped so a runaway
 * snippet never becomes a claim. */
const field = (label: string) => new RegExp(`${label}\\s*:\\s*([^;\\n]{2,120}?)(?=\\s*(?:;|\\.\\.\\.|…|$|\\s(?:Industry|Company size|Headquarters|Type|Founded|Specialties|Website)\\s*:))`, "i");
const INDUSTRY = field("Industry");
const SIZE = field("Company size");
const HQ = field("Headquarters");

const clean = (value: string) => value.replace(/\s+/g, " ").replace(/[\s.,;]+$/, "").trim();

export function extractProfileSnippetClaims(snippet: string): ProfileSnippetClaims {
  const text = (snippet ?? "").slice(0, 4000);
  const out: ProfileSnippetClaims = {};
  const industry = text.match(INDUSTRY)?.[1];
  if (industry) {
    const value = clean(industry);
    if (value.length >= 2 && value.length <= 80) out.industry = value;
  }
  const size = text.match(SIZE)?.[1];
  if (size) {
    // "201-500 employees", "10,001+ employees", "51-200"
    const value = clean(size).replace(/\s*employees?$/i, "");
    if (/^\d[\d,]*(?:\s*[-–]\s*\d[\d,]*|\+)?$/.test(value)) out.employeeSize = value.replace(/\s*[-–]\s*/, "-");
  }
  const hq = text.match(HQ)?.[1];
  if (hq) {
    const value = clean(hq);
    // The field is labelled, so a single word ("Sunnyvale") is a stated
    // headquarters, not a guess. Truncation is kept as far as it is stated.
    if (value.length >= 3 && value.length <= 80 && /^[A-Za-z]/.test(value)) {
      out.geography = [{ type: "HEADQUARTERS", value }];
    }
  }
  return out;
}
