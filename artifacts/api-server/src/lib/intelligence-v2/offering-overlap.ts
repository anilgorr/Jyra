/**
 * Deterministic seller-offering overlap detection. Research mints
 * OFFERING_OVERLAP atomic claims from first-party pages and provider
 * descriptions when a company's own text names the seller's offering or one
 * of its material capabilities. The claims are evidence only: the semantic
 * assessment decides whether they establish a MATERIAL_SUBSTITUTE, and the
 * competitor safety rule then excludes the company from buyer targeting.
 *
 * Detection is conservative: a multi-word offering phrase must appear as a
 * whole-token sequence, or at least two distinctive tokens of the phrase must
 * co-occur within a short window. Generic business vocabulary never counts.
 */

export type SellerOfferingV2 = {
  name?: string | null;
  description?: string | null;
  materialCapabilities?: string[] | null;
};

export type OfferingOverlapMatchV2 = { phrase: string; excerpt: string; matchedTokens: string[]; mode: "PHRASE" | "TOKENS" };

export const GENERIC_OFFERING_TOKENS: ReadonlySet<string> = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "our", "you", "are", "all", "any", "into", "via", "per", "of",
  "platform", "platforms", "provider", "providers", "solution", "solutions", "service", "services", "software", "technology", "technologies",
  "company", "companies", "data", "management", "managed", "digital", "business", "businesses", "cloud", "tool", "tools", "system", "systems",
  "product", "products", "offering", "offerings", "enterprise", "customer", "customers", "client", "clients", "team", "teams", "support",
  "professional", "advanced", "modern", "smart", "intelligent", "integrated", "end", "based", "driven", "powered", "leading", "global",
  "online", "app", "apps", "application", "applications", "suite", "program", "programs", "process", "processes", "operations", "operational",
  "help", "helps", "helping", "enable", "enables", "deliver", "delivers", "provide", "provides", "build", "builds", "make", "makes",
  "new", "best", "top", "full", "complete", "custom", "expert", "experts", "quality", "value", "results", "outcome", "outcomes",
  "monitoring", "analytics", "insights", "reporting", "consulting", "strategy", "strategic", "experience", "experiences", "growth", "performance",
]);

const normalize = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const singular = (token: string) => token.length > 3 && token.endsWith("s") ? (token.endsWith("ies") ? `${token.slice(0, -3)}y` : /(?:s|x|z|ch|sh)es$/.test(token) ? token.slice(0, -2) : token.slice(0, -1)) : token;
const tokenPattern = (token: string) => {
  const base = singular(token);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return base === token ? `${escaped}(?:s|es|ies)?` : `${escaped}(?:s|es|ies|y)?`;
};
const WINDOW = 240;

export function offeringPhrasesV2(offering: SellerOfferingV2 | null | undefined): string[] {
  if (!offering) return [];
  const raw = [offering.name, ...(offering.materialCapabilities ?? [])];
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const trimmed = value.replace(/\s+/g, " ").trim();
    const key = normalize(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    phrases.push(trimmed);
  }
  return phrases;
}

export function distinctiveOfferingTokensV2(phrase: string): string[] {
  return [...new Set(normalize(phrase).split(" ").filter((token) => token.length > 2 && !GENERIC_OFFERING_TOKENS.has(token) && !/^\d+$/.test(token)))];
}

const excerptAround = (text: string, index: number, length: number) => {
  const start = Math.max(0, index - 100);
  const end = Math.min(text.length, index + length + 100);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
};

export function detectOfferingOverlapV2(text: string, offering: SellerOfferingV2 | null | undefined): OfferingOverlapMatchV2[] {
  if (!text?.trim()) return [];
  const matches: OfferingOverlapMatchV2[] = [];
  for (const phrase of offeringPhrasesV2(offering)) {
    const tokens = normalize(phrase).split(" ").filter(Boolean);
    const distinctive = distinctiveOfferingTokensV2(phrase);
    if (!distinctive.length) continue;
    if (tokens.length >= 2) {
      const phraseRegex = new RegExp(`(?<![a-z0-9])${tokens.map(tokenPattern).join("[^a-z0-9]+")}(?![a-z0-9])`, "i");
      const hit = phraseRegex.exec(text);
      if (hit) {
        matches.push({ phrase, excerpt: excerptAround(text, hit.index, hit[0].length), matchedTokens: tokens, mode: "PHRASE" });
        continue;
      }
    }
    if (distinctive.length < 2) continue;
    const positions = distinctive.map((token) => {
      const hit = new RegExp(`(?<![a-z0-9])${tokenPattern(token)}(?![a-z0-9])`, "i").exec(text);
      return hit ? { token, index: hit.index, length: hit[0].length } : null;
    }).filter((value): value is NonNullable<typeof value> => Boolean(value));
    if (positions.length < 2) continue;
    positions.sort((a, b) => a.index - b.index);
    const clustered = positions.filter((position, index, all) => all.some((other, otherIndex) => otherIndex !== index && Math.abs(other.index - position.index) <= WINDOW));
    if (clustered.length < 2) continue;
    const first = clustered[0]!;
    const last = clustered[clustered.length - 1]!;
    matches.push({ phrase, excerpt: excerptAround(text, first.index, last.index + last.length - first.index), matchedTokens: clustered.map((item) => item.token), mode: "TOKENS" });
  }
  return matches;
}

/** Extracts the seller offering shape from the free-form context object handed to the orchestrator. */
export function sellerOfferingFromContextV2(offering: Record<string, unknown> | null | undefined): SellerOfferingV2 | null {
  if (!offering || typeof offering !== "object") return null;
  const name = typeof offering.name === "string" ? offering.name : null;
  const description = typeof offering.description === "string" ? offering.description : null;
  const materialCapabilities = Array.isArray(offering.materialCapabilities)
    ? offering.materialCapabilities.filter((value): value is string => typeof value === "string")
    : [];
  return name || description || materialCapabilities.length ? { name, description, materialCapabilities } : null;
}
