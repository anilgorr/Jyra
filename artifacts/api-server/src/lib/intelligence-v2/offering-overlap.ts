/**
 * Deterministic seller-offering overlap detection. Research mints
 * OFFERING_OVERLAP atomic claims from first-party pages and provider
 * descriptions when a company's own text names the seller's offering or one
 * of its material capabilities. The claims are evidence only: the semantic
 * assessment decides whether they establish a MATERIAL_SUBSTITUTE, and the
 * competitor safety rule then excludes the company from buyer targeting.
 *
 * Detection is conservative: a multi-word offering phrase must appear as a
 * whole-token sequence, or all of its (at least two) distinctive tokens must
 * co-occur inside one sentence within a short word window. Generic business
 * vocabulary never counts.
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
  /* Measured, not guessed. Document frequency across the launch pool's 116
   * crawled company sites: contact 74%, scale 59%, connect 56%, email 49%,
   * revenue 43%, improve 38%, intelligence 37%, single 30%, saas 28%,
   * workflow 26%, channel 22%, call 22%, integration 19%, manual 15%,
   * b2b 13%, list 12%, workspace 10%. A word most of a market uses says
   * nothing about whether two companies sell the same thing. For contrast,
   * the words that do: sequencing 0%, outbound 2%, cadence 2%, prospecting
   * 3%, enrich 3%, enrichment 5%. */
  "contact", "contacts", "scale", "connect", "email", "emails", "revenue", "improve", "intelligence", "single",
  "saas", "workflow", "workflows", "channel", "channels", "call", "calls", "integration", "integrations",
  "manual", "b2b", "list", "lists", "workspace", "building", "lead", "leads", "target", "targets", "task", "tasks",
]);

const normalize = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const singular = (token: string) => token.length > 3 && token.endsWith("s") ? (token.endsWith("ies") ? `${token.slice(0, -3)}y` : /(?:s|x|z|ch|sh)es$/.test(token) ? token.slice(0, -2) : token.slice(0, -1)) : token;
const tokenPattern = (token: string) => {
  const base = singular(token);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return base === token ? `${escaped}(?:s|es|ies)?` : `${escaped}(?:s|es|ies|y)?`;
};
/** Distinctive tokens must all appear inside one sentence within this many words of each other. */
const TOKEN_WINDOW = 10;
const SENTENCE = /[^.!?;\n]+/g;
const WORD = /[a-z0-9]+/gi;
function tokensCoOccur(text: string, distinctive: string[]): { index: number; length: number } | null {
  const wanted = distinctive.map(singular);
  for (const sentence of text.matchAll(SENTENCE)) {
    const words = [...sentence[0].matchAll(WORD)].map((word) => ({ stem: singular(word[0].toLowerCase()), index: sentence.index! + word.index!, length: word[0].length }));
    for (let start = 0; start < words.length; start++) {
      const window = words.slice(start, start + TOKEN_WINDOW);
      if (wanted.every((token) => window.some((word) => word.stem === token))) {
        const last = window.filter((word) => wanted.includes(word.stem)).at(-1)!;
        return { index: words[start]!.index, length: last.index + last.length - words[start]!.index };
      }
    }
  }
  return null;
}

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
    const hit = tokensCoOccur(text, distinctive);
    if (hit) matches.push({ phrase, excerpt: excerptAround(text, hit.index, hit.length), matchedTokens: distinctive, mode: "TOKENS" });
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

/**
 * Capability-area overlap: the thing the phrase matcher above cannot do.
 *
 * `detectOfferingOverlapV2` requires every distinctive token of a seller
 * phrase to appear inside one sentence within ten words. That is near-exact
 * sentence matching, and two vendors selling the identical capability do not
 * write the identical sentence. Measured against Clay's real pricing text -
 * "Give reps the best prospecting data", "native sequencer", "Enrich phone
 * numbers", "Track job changes or other signals" - it returned zero matches,
 * while Clay sells the seller's own product. The final validator will not
 * accept SELLER_COMPETITOR without a cited overlap claim, so zero matches
 * means the verdict cannot be reached however obvious it is, and Clay led the
 * launch project's ranked list.
 *
 * So match capability AREAS instead. A seller's offering text is split into
 * clauses; each clause that carries a distinctive word is an area, and an
 * area is matched when the candidate's own words use one of its words. One
 * area matched is not overlap - every analytics vendor says "enrichment" and
 * a durable-execution engine says "cadence" for reasons of its own. Two
 * distinct areas is overlap: it means the candidate claims to do two
 * different things the seller does.
 *
 * Measured over the launch pool's 116 crawled companies, two areas caught
 * Clay, 6sense, Demandbase and Gong with no false positive. One area caught
 * Typeform ("enrichment" on a form builder), Temporal ("cadence", which is
 * the name of the project it forked from), Okta, Alloy, Heap, Hightouch,
 * FullStory and Algolia - eight legitimate buyers wrongly called competitors.
 * That measurement is the fixture in test-offering-overlap-areas.mjs.
 *
 * `commonTokens` is what makes this portable between verticals. A word is
 * uninformative when everyone in the pool uses it, and that is measurable
 * rather than a matter of opinion: in this pool "data" appears on 88% of
 * company sites and "email" on 50%, while "sequenc" and "intent data" appear
 * on under 2%. The caller passes the words its own corpus found common; with
 * none passed, the static list above is used and the rule still holds.
 */
export type CapabilityAreaV2 = { phrase: string; heads: string[] };
export type CapabilityAreaMatchV2 = { phrase: string; matchedHeads: string[]; excerpt: string };

/** Where one stated capability ends and the next begins. */
const CLAUSE_BOUNDARY = /[.;:\n]|,| and | with | that | which | for | from | to | plus | including /i;
/** Two areas. Below this a shared word is a coincidence; at it, the candidate claims two of the seller's capabilities. */
export const MATERIAL_AREA_THRESHOLD = 2;

export function offeringCapabilityAreasV2(
  offering: SellerOfferingV2 | null | undefined,
  commonTokens: ReadonlySet<string> = GENERIC_OFFERING_TOKENS,
): CapabilityAreaV2[] {
  if (!offering) return [];
  /* A curated capability list is one area per entry and needs no splitting.
   * Prose does, and prose is much weaker: measured over the launch pool,
   * areas cut from the seller's description alone flagged Writer, Appcues,
   * Klaviyo and Typeform alongside the real competitors, because a
   * description yields ambient words - "crm", "rep", "sale", "target" - that
   * every sales-adjacent site uses. The same rule over a capability list
   * ("contact database", "data enrichment", "email sequencing") flagged four
   * of the six known competitors and two non-competitors out of 116. So use
   * the list when there is one, and fall back to prose only to have
   * something rather than nothing. */
  const capabilities = (offering.materialCapabilities ?? []).filter((value) => typeof value === "string" && value.trim());
  const sources = capabilities.length ? capabilities : [offering.name, offering.description];
  const areas: CapabilityAreaV2[] = [];
  const claimed = new Set<string>();
  for (const source of sources) {
    if (typeof source !== "string") continue;
    for (const clause of source.split(CLAUSE_BOUNDARY)) {
      const phrase = clause.replace(/\s+/g, " ").trim();
      if (!phrase) continue;
      const heads = distinctiveOfferingTokensV2(phrase)
        .map(singular)
        .filter((token) => token.length > 2 && !commonTokens.has(token) && !commonTokens.has(`${token}s`));
      // A clause of nothing but common words states no capability. Dropping it
      // is the difference between an area and a phrase that matches everyone.
      if (!heads.length) continue;
      // A word belongs to the first area that claimed it, so two clauses
      // phrased around the same word are one area, not two.
      const fresh = heads.filter((token) => !claimed.has(token));
      if (!fresh.length) continue;
      for (const token of fresh) claimed.add(token);
      areas.push({ phrase, heads: fresh });
    }
  }
  return areas;
}

/**
 * The stem a capability word shares with the forms a rival will use.
 *
 * A seller writes "data enrichment" and "outbound email sequencing"; Clay's
 * own pricing page says "Enrich phone numbers" and "native sequencer".
 * Matching on the whole word missed both - two real capability areas lost to
 * a suffix. So strip the suffix that turns a verb into a noun and match the
 * stem with whatever ending the other company chose.
 *
 * Only for words long enough that the stem is still specific: "list" and
 * "lead" stay whole, or "list" would match "listen".
 */
const CAPABILITY_SUFFIX = /(?:ments?|tions?|sions?|ings?|ers?|eds?|ance|ence)$/;
export function capabilityStem(head: string): string {
  if (head.length < 7) return head;
  const stem = head.replace(CAPABILITY_SUFFIX, "");
  return stem.length >= 5 ? stem : head;
}

export function capabilityAreaOverlapV2(
  text: string,
  offering: SellerOfferingV2 | null | undefined,
  commonTokens: ReadonlySet<string> = GENERIC_OFFERING_TOKENS,
): CapabilityAreaMatchV2[] {
  if (!text?.trim()) return [];
  const matches: CapabilityAreaMatchV2[] = [];
  for (const area of offeringCapabilityAreasV2(offering, commonTokens)) {
    const matchedHeads: string[] = [];
    let first: { index: number; length: number } | null = null;
    for (const head of area.heads) {
      const stem = capabilityStem(head);
      const pattern = stem === head
        ? `(?<![a-z0-9])${tokenPattern(head)}(?![a-z0-9])`
        : `(?<![a-z0-9])${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z]{0,5}(?![a-z0-9])`;
      const hit = new RegExp(pattern, "i").exec(text);
      if (!hit) continue;
      matchedHeads.push(head);
      if (!first) first = { index: hit.index, length: hit[0].length };
    }
    if (first) matches.push({ phrase: area.phrase, matchedHeads, excerpt: excerptAround(text, first.index, first.length) });
  }
  return matches;
}

/** Enough shared capability areas to call the candidate a material substitute. */
export function materialOverlapV2(
  text: string,
  offering: SellerOfferingV2 | null | undefined,
  commonTokens: ReadonlySet<string> = GENERIC_OFFERING_TOKENS,
): { material: boolean; areas: CapabilityAreaMatchV2[] } {
  const areas = capabilityAreaOverlapV2(text, offering, commonTokens);
  return { material: areas.length >= MATERIAL_AREA_THRESHOLD, areas };
}
