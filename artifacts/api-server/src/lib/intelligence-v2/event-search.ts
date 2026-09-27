import { and, desc, eq, inArray } from "drizzle-orm";
import {
  companiesTable,
  companyEventSearchesTable,
  db,
  LIVE_PROJECT_COMPANY_STATUSES,
  projectCompaniesTable,
  projectSignalPacksTable,
  projectsTable,
  signalDefinitionsTable,
} from "@workspace/db";
import { ProviderRouter } from "../provider-router";
import { evaluateSignalsForCompany } from "../signal-packs";
import { evaluateClustersForCompany } from "../signal-clusters";
import { evaluateOpportunity } from "../opportunity-engine";
import { resolveCompanyCountry } from "./company-country";
import {
  eventSearchPlanFromDefinitions,
  loadPriorEvents,
  mapEventHitsToFacts,
  persistEventFacts,
  planEventSearch,
  researchEvents,
  buildEventQueries,
  eventQuerySetSignature,
  SEARCH_EVERYTHING,
  type EventFactRow,
  type EventSearchHistory,
  type EventSearchPlan,
  type EventSearchWindow,
} from "./event-facts";

/**
 * Where a company's news search is decided, run and recorded.
 *
 * The cycle and the events-only sweep both come through here, so the pack
 * decides what is asked, the history decides the window, and every search
 * leaves a row saying what it cost and what it found.
 */

function factTypesOf(requirements: unknown): string[] {
  if (Array.isArray(requirements)) return requirements.filter((t): t is string => typeof t === "string");
  const types = (requirements as { factTypes?: unknown } | null)?.factTypes;
  return Array.isArray(types) ? types.filter((t): t is string => typeof t === "string") : [];
}

export async function loadEventSearchPlan(projectId: string): Promise<EventSearchPlan> {
  const rows = await db.select({
    code: signalDefinitionsTable.code,
    name: signalDefinitionsTable.name,
    description: signalDefinitionsTable.description,
    factRequirements: signalDefinitionsTable.factRequirements,
    configuration: signalDefinitionsTable.configuration,
  }).from(signalDefinitionsTable)
    .innerJoin(projectSignalPacksTable, eq(projectSignalPacksTable.signalPackId, signalDefinitionsTable.signalPackId))
    .where(and(eq(projectSignalPacksTable.projectId, projectId), eq(projectSignalPacksTable.active, true)));
  return eventSearchPlanFromDefinitions(rows.map((row) => ({
    factTypes: factTypesOf(row.factRequirements),
    text: [row.code, row.name, row.description, JSON.stringify(row.configuration ?? {})].join(" "),
  })));
}

export async function loadEventSearchHistory(companyId: string, projectId: string): Promise<EventSearchHistory> {
  const rows = await db.select({
    searchedAt: companyEventSearchesTable.searchedAt,
    window: companyEventSearchesTable.window,
    querySet: companyEventSearchesTable.querySet,
  }).from(companyEventSearchesTable)
    .where(and(eq(companyEventSearchesTable.companyId, companyId), eq(companyEventSearchesTable.projectId, projectId)))
    .orderBy(desc(companyEventSearchesTable.searchedAt)).limit(20);
  const lastYear = rows.find((row) => row.window === "year");
  return {
    lastSearchAt: rows[0]?.searchedAt ?? null,
    lastYearSweep: lastYear ? { at: lastYear.searchedAt, querySet: lastYear.querySet } : null,
  };
}

export type EventSearchOutcome = {
  searched: boolean;
  window: EventSearchWindow;
  querySet: string;
  queries: number;
  hits: number;
  facts: EventFactRow[];
  skipped: Record<string, number>;
  providers: string[];
};

const tally = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => { acc[v] = (acc[v] ?? 0) + 1; return acc; }, {});

/**
 * Decide, search and map - but not persist, so a cycle can write the facts
 * inside its own transaction. `force` searches even inside the weekly
 * interval (the sweep endpoint); the window still follows the history.
 */
export async function searchCompanyEvents(input: {
  organizationId: string; projectId: string; projectCompanyId: string;
  company: { id: string; canonicalName: string; domain: string | null; description: string | null; industry: string | null; country: string | null };
  plan: EventSearchPlan; now: Date; force?: boolean;
}): Promise<EventSearchOutcome> {
  const querySet = eventQuerySetSignature(buildEventQueries(input.company.canonicalName, input.company.domain, { plan: input.plan }));
  const history = await loadEventSearchHistory(input.company.id, input.projectId).catch(() => ({ lastSearchAt: null, lastYearSweep: null }));
  const decision = planEventSearch(history, querySet, input.now);
  if (decision.action === "SKIP" && !input.force) {
    return { searched: false, window: decision.window, querySet, queries: 0, hits: 0, facts: [], skipped: {}, providers: [] };
  }
  const { country } = resolveCompanyCountry({ storedCountry: input.company.country, domain: input.company.domain });
  const router = new ProviderRouter();
  const events = await researchEvents(
    (request) => router.searchWeb({
      ...request,
      metadata: { organizationId: input.organizationId, projectId: input.projectId, companyId: input.company.id, projectCompanyId: input.projectCompanyId },
    }).then((r) => ({ status: r.status, data: r.data, providerId: r.providerId })),
    {
      requestId: `${input.projectCompanyId}:events`, companyName: input.company.canonicalName, domain: input.company.domain,
      country, now: input.now, plan: input.plan, window: decision.window,
    },
  );
  const priorEvents = await loadPriorEvents(input.company.id, input.now).catch(() => []);
  const mapped = mapEventHitsToFacts(events.hits, {
    companyId: input.company.id, companyName: input.company.canonicalName, domain: input.company.domain, now: input.now,
    companyDescription: [input.company.description, input.company.industry].filter(Boolean).join(". "),
    priorEvents,
  });
  return {
    searched: true, window: events.window, querySet: events.querySet, queries: events.queries, hits: events.hits.length,
    facts: mapped.facts, skipped: tally(mapped.skipped.map((item) => item.reason)), providers: events.providers,
  };
}

/** Write down a search that ran. Best-effort: losing the row costs one extra search later, nothing more. */
export async function recordEventSearch(input: {
  companyId: string; projectId: string; trigger: "CYCLE" | "SWEEP"; outcome: EventSearchOutcome; now: Date;
}): Promise<void> {
  if (!input.outcome.searched) return;
  await db.insert(companyEventSearchesTable).values({
    companyId: input.companyId, projectId: input.projectId, searchedAt: input.now,
    window: input.outcome.window, querySet: input.outcome.querySet, trigger: input.trigger,
    queries: input.outcome.queries, hits: input.outcome.hits, usable: input.outcome.facts.length,
    skipped: input.outcome.skipped,
  }).catch(() => undefined);
}

export type EventSweepReport = {
  projectId: string;
  startedAt: string;
  finishedAt: string | null;
  companies: number;
  searched: number;
  queries: number;
  hits: number;
  usable: number;
  factsInserted: number;
  byWindow: Record<string, number>;
  failures: Array<{ projectCompanyId: string; error: string }>;
};

/**
 * News only, for every live company in a project: search, store, re-derive
 * signals, re-score. No page crawl and no model call, so it costs the searches
 * and nothing else - about a tenth of a US cent each.
 *
 * The watch loop runs a company's news search inside its research cycle, and
 * the change gate skips that cycle when the website has not moved. News does
 * not wait for a website, so this is how a new query vocabulary reaches a pool
 * in one pass rather than over a month of refresh windows.
 */
export async function runEventSweep(input: {
  projectId: string; limit?: number; concurrency?: number; force?: boolean; onProgress?: (report: EventSweepReport) => void;
}): Promise<EventSweepReport> {
  const [project] = await db.select({ organizationId: projectsTable.organizationId })
    .from(projectsTable).where(eq(projectsTable.id, input.projectId)).limit(1);
  if (!project?.organizationId) throw new Error(`Project ${input.projectId} not found`);
  const organizationId = project.organizationId;
  const plan = await loadEventSearchPlan(input.projectId).catch(() => SEARCH_EVERYTHING);

  let rows = await db.select({
    projectCompanyId: projectCompaniesTable.id,
    company: {
      id: companiesTable.id, canonicalName: companiesTable.canonicalName, domain: companiesTable.domain,
      description: companiesTable.description, industry: companiesTable.industry, country: companiesTable.country,
    },
  }).from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .where(and(
      eq(projectCompaniesTable.projectId, input.projectId),
      inArray(projectCompaniesTable.status, [...LIVE_PROJECT_COMPANY_STATUSES]),
    ));
  if (input.limit) rows = rows.slice(0, input.limit);

  const report: EventSweepReport = {
    projectId: input.projectId, startedAt: new Date().toISOString(), finishedAt: null, companies: rows.length,
    searched: 0, queries: 0, hits: 0, usable: 0, factsInserted: 0, byWindow: {}, failures: [],
  };
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++]!;
      const now = new Date();
      try {
        const outcome = await searchCompanyEvents({
          organizationId, projectId: input.projectId, projectCompanyId: row.projectCompanyId,
          company: row.company, plan, now, force: input.force ?? true,
        });
        if (outcome.searched) {
          report.searched += 1;
          report.queries += outcome.queries;
          report.hits += outcome.hits;
          report.usable += outcome.facts.length;
          report.byWindow[outcome.window] = (report.byWindow[outcome.window] ?? 0) + 1;
          if (outcome.facts.length) {
            const stored = await db.transaction((tx) => persistEventFacts({
              organizationId, companyId: row.company.id, companyDomain: row.company.domain, facts: outcome.facts, now,
            }, tx));
            report.factsInserted += stored.factsInserted;
          }
          await recordEventSearch({ companyId: row.company.id, projectId: input.projectId, trigger: "SWEEP", outcome, now });
          await evaluateSignalsForCompany({ organizationId, projectId: input.projectId, companyId: row.company.id });
          await evaluateClustersForCompany({ organizationId, projectId: input.projectId, companyId: row.company.id });
          await evaluateOpportunity({ organizationId, projectId: input.projectId, projectCompanyId: row.projectCompanyId, userId: "internal-event-sweep" });
        }
      } catch (error) {
        report.failures.push({ projectCompanyId: row.projectCompanyId, error: error instanceof Error ? error.message : String(error) });
      }
      input.onProgress?.(report);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(8, input.concurrency ?? 4)) }, worker));
  report.finishedAt = new Date().toISOString();
  return report;
}
