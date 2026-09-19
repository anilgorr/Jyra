/**
 * Headcount from the LinkedIn pages the pool has already paid for.
 *
 * Every company in the launch pool has a country and an industry; not one of
 * the 119 has a headcount. The firmographics provider that writes that column
 * has refused every request the pipeline has made, so a seller's mandatory
 * company-size criterion - for a sales-intelligence seller, the most
 * discriminating filter they have - evaluates unknown for every company and
 * decides nothing.
 *
 * The figure is already in the database. 372 LinkedIn company pages are
 * stored across all 119 companies and 82 of them state a size in plain text
 * ("Company size: 201-500 employees"). Reading it costs no provider call.
 *
 * What it costs is care about entity, and the pool proves why: the stored
 * pages for "Vitally" include Vitally Vegan Baked Goods at 2-10 employees,
 * and "Runway" matches both a personal-finance app at 2-10 and runwayml at
 * 51-200. A wrong headcount on a mandatory criterion is worse than none - it
 * disqualifies a real buyer silently. So a page counts only when it states
 * the company's own domain, which LinkedIn prints in its Website field. Of
 * the 82, 62 clear that bar; the other 20 stay unknown, which is the honest
 * outcome rather than a coin flip.
 *
 * A band is stored as a band. LinkedIn never publishes a count, and writing a
 * midpoint into employee_count would turn "somewhere between 201 and 500"
 * into a false precision every downstream reader would trust.
 */

export type StatedHeadcount = { range: string; min: number; max: number | null; evidenceId: string; sourceUrl: string };

export type HeadcountCandidate = { evidenceId: string; sourceUrl: string; text: string };

const SIZE_FIELD = /Company size:?\s*([0-9][0-9,]*(?:\s*[-–]\s*[0-9][0-9,]*|\s*\+)?)\s*employees?/i;

/** The company's own domain, as LinkedIn prints it - bare, or behind http(s) and www. */
function statesDomain(text: string, domain: string): boolean {
  const bare = domain.replace(/^www\./i, "").toLowerCase();
  if (!bare || !bare.includes(".")) return false;
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9.-])(?:www\\.)?${escaped}(?![a-z0-9-])`, "i").test(text);
}

export function parseStatedSize(text: string): { range: string; min: number; max: number | null } | null {
  const match = text.match(SIZE_FIELD);
  if (!match) return null;
  const raw = match[1]!.replace(/\s+/g, "").replace(/–/g, "-");
  const open = raw.match(/^([0-9,]+)\+$/);
  if (open) {
    const min = Number(open[1]!.replace(/,/g, ""));
    return Number.isFinite(min) ? { range: `${open[1]}+`, min, max: null } : null;
  }
  const bounded = raw.match(/^([0-9,]+)-([0-9,]+)$/);
  if (!bounded) return null;
  const min = Number(bounded[1]!.replace(/,/g, ""));
  const max = Number(bounded[2]!.replace(/,/g, ""));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
  return { range: `${bounded[1]}-${bounded[2]}`, min, max };
}

/**
 * The one headcount a company's stored pages support, or nothing.
 *
 * Disagreement is not averaged or voted on. Two different sizes on two pages
 * that both name the domain means one of them is a different company under a
 * similar name, and which one cannot be told from here.
 */
export function headcountFromProfiles(
  candidates: readonly HeadcountCandidate[],
  domain: string | null | undefined,
): StatedHeadcount | null {
  if (!domain) return null;
  const found: StatedHeadcount[] = [];
  for (const candidate of candidates) {
    if (!statesDomain(candidate.text, domain)) continue;
    const size = parseStatedSize(candidate.text);
    if (!size) continue;
    found.push({ ...size, evidenceId: candidate.evidenceId, sourceUrl: candidate.sourceUrl });
  }
  if (!found.length) return null;
  const distinct = new Set(found.map((item) => item.range));
  if (distinct.size > 1) return null;
  return found[0]!;
}
