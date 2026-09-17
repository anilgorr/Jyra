import { and, eq, inArray } from "drizzle-orm";
import { companyFactsTable, db, signalDefinitionsTable, signalsTable } from "@workspace/db";
import { TIMELESS_FACT_TYPES } from "./facts";

/**
 * One line that says why a company is on the list.
 *
 * The ranked list showed a score, a state and "assessment complete", and a
 * seller looking at UpGrad at rank 4 left it unrated because nothing on the
 * row told them what JYRA had found. The engine's own explanation ("weighted
 * opportunity strength is 45.03") is for the engine.
 *
 * So each row gets the single most important thing we know: the strongest
 * negative if there is one (a layoff outranks any positive), else the
 * strongest event ("Director - Portfolio Marketing, 24 Jul"), else the
 * standing facts ("Uses HubSpot, Salesforce - nothing has happened yet"),
 * else nothing at all - and "nothing found yet" is itself the honest line.
 */
export type OpportunityHeadline = {
  kind: "negative" | "event" | "standing" | "none";
  signal: string | null;
  text: string;
  date: string | null;
};

const TIMELESS = new Set<string>(TIMELESS_FACT_TYPES);
const MAX_TEXT = 90;

function trim(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1)}…` : clean;
}

/** What a fact says, in the words a seller would use. */
export function factLabel(fact: { factType: string; structuredValue: unknown; supportingExcerpt: string }): string {
  const value = (fact.structuredValue ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof value[key] === "string" && (value[key] as string).trim() ? (value[key] as string).trim() : null);
  switch (fact.factType) {
    case "JOB_OPENING": return trim(str("title") ?? fact.supportingExcerpt);
    case "TECHNOLOGY_MENTION": return trim(str("product") ?? fact.supportingExcerpt);
    case "LEADERSHIP_CHANGE": {
      const person = str("person"); const role = str("role");
      return trim(person && role ? `${person}, ${role}` : role ?? person ?? fact.supportingExcerpt);
    }
    case "HIRING_COUNT": {
      const count = value.count; const theme = str("theme");
      return trim(typeof count === "number" && theme && theme !== "all" ? `${count} ${theme} openings` : fact.supportingExcerpt);
    }
    default: return trim(fact.supportingExcerpt);
  }
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

type SignalRow = {
  companyId: string;
  polarity: string;
  name: string;
  strength: number;
  effectiveDate: string;
  factIds: string[];
};
type FactRow = { id: string; factType: string; structuredValue: unknown; supportingExcerpt: string; effectiveDate: string | null };

/** Pure: pick the headline for one company from its active signals and their facts. Exported for tests. */
export function headlineFor(signals: SignalRow[], factsById: ReadonlyMap<string, FactRow>): OpportunityHeadline {
  const classified = signals.map((signal) => {
    const facts = signal.factIds.map((id) => factsById.get(id)).filter((f): f is FactRow => Boolean(f));
    const standing = facts.length > 0 && facts.every((f) => TIMELESS.has(f.factType));
    return { signal, facts, standing };
  });

  const negative = classified.filter((c) => c.signal.polarity === "NEGATIVE").sort((a, b) => b.signal.strength - a.signal.strength)[0];
  if (negative) {
    const fact = negative.facts[0];
    return {
      kind: "negative",
      signal: negative.signal.name,
      text: fact ? factLabel(fact) : negative.signal.name,
      date: shortDate(fact?.effectiveDate ?? negative.signal.effectiveDate),
    };
  }

  const event = classified.filter((c) => c.signal.polarity !== "NEGATIVE" && !c.standing).sort((a, b) => b.signal.strength - a.signal.strength)[0];
  if (event) {
    // The most recent supporting fact is the one that made it an event.
    const fact = [...event.facts].filter((f) => !TIMELESS.has(f.factType)).sort((a, b) => (b.effectiveDate ?? "").localeCompare(a.effectiveDate ?? ""))[0] ?? event.facts[0];
    return {
      kind: "event",
      signal: event.signal.name,
      text: fact ? factLabel(fact) : event.signal.name,
      date: shortDate(fact?.effectiveDate ?? event.signal.effectiveDate),
    };
  }

  const standing = classified.filter((c) => c.standing);
  if (standing.length) {
    const products = new Set<string>();
    for (const c of standing) for (const f of c.facts) products.add(factLabel(f));
    const list = [...products].slice(0, 3).join(", ") + (products.size > 3 ? ` +${products.size - 3}` : "");
    return { kind: "standing", signal: standing[0]!.signal.name, text: `Uses ${list} — nothing has happened yet`, date: null };
  }

  return { kind: "none", signal: null, text: "Nothing found yet — fit only", date: null };
}

/** Headlines for every company in a project, keyed by company id. One query for signals, one for facts. */
export async function opportunityHeadlines(projectId: string, companyIds: string[]): Promise<Map<string, OpportunityHeadline>> {
  const result = new Map<string, OpportunityHeadline>();
  if (!companyIds.length) return result;

  const rows = await db.select({
    companyId: signalsTable.companyId,
    polarity: signalDefinitionsTable.polarity,
    name: signalDefinitionsTable.name,
    strength: signalsTable.currentStrength,
    effectiveDate: signalsTable.effectiveDate,
    factIds: signalsTable.supportingFactIds,
  })
    .from(signalsTable)
    .innerJoin(signalDefinitionsTable, eq(signalDefinitionsTable.id, signalsTable.signalDefinitionId))
    .where(and(eq(signalsTable.projectId, projectId), inArray(signalsTable.companyId, companyIds), eq(signalsTable.status, "ACTIVE")));

  const factIds = [...new Set(rows.flatMap((r) => r.factIds ?? []))];
  const facts = factIds.length
    ? await db.select({
      id: companyFactsTable.id,
      factType: companyFactsTable.factType,
      structuredValue: companyFactsTable.structuredValue,
      supportingExcerpt: companyFactsTable.supportingExcerpt,
      effectiveDate: companyFactsTable.effectiveDate,
    }).from(companyFactsTable).where(inArray(companyFactsTable.id, factIds))
    : [];
  const factsById = new Map<string, FactRow>(facts.map((f) => [f.id, { ...f, factType: f.factType as string }]));

  const byCompany = new Map<string, SignalRow[]>();
  for (const r of rows) {
    const list = byCompany.get(r.companyId) ?? [];
    list.push({ ...r, polarity: r.polarity as string, factIds: r.factIds ?? [] });
    byCompany.set(r.companyId, list);
  }
  for (const id of companyIds) result.set(id, headlineFor(byCompany.get(id) ?? [], factsById));
  return result;
}
