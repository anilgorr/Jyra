import { normalizeCompanyName } from "./company-name";

/**
 * The competitors a seller named, out of the field where they were asked for
 * them.
 *
 * The Business Twin has always asked "What you're compared against", and the
 * answer is the strongest competitor signal that exists: the seller's own
 * statement. Apollo.io's answer lists ZoomInfo, Lusha, Salesloft and Outreach.
 * Nothing in the pipeline read it. Instead the competitor gate tried to infer
 * overlap from competitors' marketing copy, which describes what they sell in
 * deliberately different words - so ZoomInfo, Apollo's largest competitor, was
 * assessed as a likely buyer across a full 119-company run.
 *
 * The prompt asks for two different things in one box: "Competitors, and the
 * non-purchase alternatives (in-house, do nothing)." Only the first kind is a
 * company that can appear in a pool, so the alternatives are dropped rather
 * than matched against company names.
 */

/** A non-purchase alternative describes a behaviour, not a vendor. */
const ALTERNATIVE_PHRASE = /^(?:doing|building|build|using|use|relying|rely|hiring|keeping|staying|manual|manually|in.?house|spreadsheet|nothing|status quo|no |not )/i;

/** Longest a company name plausibly runs, in words. Past this it is a sentence. */
const MAX_NAME_WORDS = 4;

export function sellerNamedCompetitors(value: unknown): string[] {
  const text = typeof value === "string" ? value : "";
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of text.split(/[\n;,]/)) {
    const entry = raw.replace(/\s+/g, " ").trim().replace(/^[-•*]\s*/, "");
    if (entry.length < 2) continue;
    if (ALTERNATIVE_PHRASE.test(entry)) continue;
    if (entry.split(" ").length > MAX_NAME_WORDS) continue;
    const key = normalizeCompanyName(entry);
    if (!key || key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    names.push(entry);
  }
  return names;
}

/**
 * Words that say what a company is rather than which one it is, so a seller
 * writing "Outreach" still matches a record reading "Outreach Corporation".
 */
const CORPORATE_FORM = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "plc", "corp", "corporation",
  "co", "company", "gmbh", "ag", "sa", "bv", "nv", "pty", "pvt", "private",
  "technologies", "technology", "systems", "solutions", "software", "labs", "group", "holdings",
]);

const tokens = (value: string): string[] => normalizeCompanyName(value).split(" ").filter(Boolean);

/**
 * Is this the company the seller named? Equal names, or one extended by
 * nothing but corporate form.
 *
 * Deliberately stricter than the general name comparison: a false match here
 * deletes a real prospect from the pool, so "Front" must not absorb "Front
 * Office Sports" in either direction.
 */
export function matchesNamedCompetitor(companyName: string, named: string): boolean {
  const a = tokens(companyName);
  const b = tokens(named);
  if (!a.length || !b.length) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!shorter.every((token, index) => longer[index] === token)) return false;
  return longer.slice(shorter.length).every((token) => CORPORATE_FORM.has(token));
}

/** The seller-named competitor this company is, or null. */
export function namedCompetitorFor(companyName: string, named: readonly string[]): string | null {
  return named.find((entry) => matchesNamedCompetitor(companyName, entry)) ?? null;
}
