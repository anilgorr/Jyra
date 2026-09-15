/**
 * Re-testing facts we already paid for against the rules as they are now.
 *
 * Signal detection only ever ran as the tail of a research cycle. That is the
 * wrong coupling, and it cost real signals: a project activates a signal pack
 * on Tuesday, and the four hundred job facts already on disk are never looked
 * at again, because looking at them requires a cycle, and a cycle only runs
 * when the change gate says a page moved. On the live database three of the
 * seven signals the stored facts had earned were missing for exactly this
 * reason — Datadog had thirteen marketing roles open and no marketing signal,
 * because the digital-marketing pack was switched on thirty-five minutes
 * after its facts landed.
 *
 * So evaluation gets its own trigger, independent of crawling. It is pure
 * database work — no provider, no model, no cost — which is why it can run on
 * every tick. The staleness check exists so that running it on every tick is
 * also nearly free: a company is re-evaluated only when a fact arrived, or a
 * pack was reconfigured, since the last time its signals were worked out.
 */

import { and, desc, eq, max, ne } from "drizzle-orm";
import {
  companyFactsTable,
  db,
  projectCompaniesTable,
  projectSignalPacksTable,
  projectsTable,
  companiesTable,
} from "@workspace/db";
import { evaluateSignalsForCompany } from "./signal-packs";

export type SignalStaleness = {
  projectCompanyId: string;
  projectId: string;
  organizationId: string;
  companyId: string;
  companyName: string;
  /** When this company's signals were last worked out. Null means never. */
  signalsEvaluatedAt: Date | null;
  /** Newest accepted-or-not fact on the company. Null means nothing to evaluate. */
  latestFactAt: Date | null;
  /** Newest active pack configuration on the project. Null means no active pack. */
  packConfiguredAt: Date | null;
};

export type StalenessVerdict = {
  stale: boolean;
  reason: "NO_ACTIVE_PACK" | "NO_FACTS" | "NEVER_EVALUATED" | "NEW_FACTS" | "PACK_RECONFIGURED" | "CURRENT";
};

/**
 * Whether this company's signals are out of date with respect to its inputs.
 *
 * Deliberately conservative in both directions. A company with no facts or no
 * active pack can produce nothing, so evaluating it is pure round trips — the
 * sweep skips it rather than confirming zero seventy times a tick. But a
 * company whose evaluation timestamp is missing is always re-evaluated, so
 * rows written before this column existed heal on the first sweep instead of
 * staying invisible forever.
 */
export function needsReevaluation(row: SignalStaleness): StalenessVerdict {
  if (!row.packConfiguredAt) return { stale: false, reason: "NO_ACTIVE_PACK" };
  if (!row.latestFactAt) return { stale: false, reason: "NO_FACTS" };
  if (!row.signalsEvaluatedAt) return { stale: true, reason: "NEVER_EVALUATED" };
  if (row.signalsEvaluatedAt < row.latestFactAt) return { stale: true, reason: "NEW_FACTS" };
  if (row.signalsEvaluatedAt < row.packConfiguredAt) return { stale: true, reason: "PACK_RECONFIGURED" };
  return { stale: false, reason: "CURRENT" };
}

/**
 * Every watched company whose signals could be out of date, newest input
 * first so that a capped sweep does the most recent work rather than an
 * arbitrary slice.
 *
 * Archived memberships are excluded: resurrecting signals on a company the
 * customer has put away is noise, and the row would only be filtered out
 * again downstream.
 */
export async function selectStaleSignalCompanies(input: { projectId?: string; limit?: number } = {}): Promise<Array<SignalStaleness & { verdict: StalenessVerdict }>> {
  const packConfigured = db.$with("pack_configured").as(
    db.select({
      projectId: projectSignalPacksTable.projectId,
      configuredAt: max(projectSignalPacksTable.updatedAt).as("configured_at"),
    }).from(projectSignalPacksTable)
      .where(eq(projectSignalPacksTable.active, true))
      .groupBy(projectSignalPacksTable.projectId),
  );
  const latestFact = db.$with("latest_fact").as(
    db.select({
      companyId: companyFactsTable.companyId,
      factAt: max(companyFactsTable.createdAt).as("fact_at"),
    }).from(companyFactsTable).groupBy(companyFactsTable.companyId),
  );

  const conditions = [ne(projectCompaniesTable.status, "archived")];
  if (input.projectId) conditions.push(eq(projectCompaniesTable.projectId, input.projectId));

  const rows = await db.with(packConfigured, latestFact).select({
    projectCompanyId: projectCompaniesTable.id,
    projectId: projectCompaniesTable.projectId,
    organizationId: projectsTable.organizationId,
    companyId: projectCompaniesTable.companyId,
    companyName: companiesTable.canonicalName,
    signalsEvaluatedAt: projectCompaniesTable.signalsEvaluatedAt,
    latestFactAt: latestFact.factAt,
    packConfiguredAt: packConfigured.configuredAt,
  }).from(projectCompaniesTable)
    .innerJoin(projectsTable, eq(projectsTable.id, projectCompaniesTable.projectId))
    .innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .innerJoin(latestFact, eq(latestFact.companyId, projectCompaniesTable.companyId))
    .innerJoin(packConfigured, eq(packConfigured.projectId, projectCompaniesTable.projectId))
    .where(and(...conditions))
    .orderBy(desc(latestFact.factAt));

  const stale = rows
    .map((row) => ({ ...row, verdict: needsReevaluation(row) }))
    .filter((row) => row.verdict.stale);
  return typeof input.limit === "number" ? stale.slice(0, input.limit) : stale;
}

export type ReevaluationOutcome = {
  projectCompanyId: string;
  companyName: string;
  projectId: string;
  reason: StalenessVerdict["reason"];
  created: number;
  total?: number;
  error?: string;
};

export type ReevaluationReport = {
  considered: number;
  evaluated: number;
  created: number;
  failed: number;
  outcomes: ReevaluationOutcome[];
};

/**
 * Work out signals for every company whose inputs moved since last time.
 *
 * One company failing does not stop the sweep — a malformed definition on one
 * project should not silently cost every other project its signals — but each
 * failure is reported, because a sweep that reports success while quietly
 * catching everything is worse than no sweep.
 */
export async function reevaluateStaleSignals(input: {
  projectId?: string;
  limit?: number;
  now?: Date;
  log?: { info: (object: object, message: string) => void; warn: (object: object, message: string) => void };
  select?: typeof selectStaleSignalCompanies;
  evaluate?: typeof evaluateSignalsForCompany;
} = {}): Promise<ReevaluationReport> {
  const select = input.select ?? selectStaleSignalCompanies;
  const evaluate = input.evaluate ?? evaluateSignalsForCompany;
  const due = await select({ projectId: input.projectId, limit: input.limit });
  const report: ReevaluationReport = { considered: due.length, evaluated: 0, created: 0, failed: 0, outcomes: [] };

  for (const row of due) {
    try {
      const result = await evaluate({
        organizationId: row.organizationId,
        projectId: row.projectId,
        companyId: row.companyId,
        now: input.now,
      });
      report.evaluated++;
      report.created += result.created.length;
      report.outcomes.push({
        projectCompanyId: row.projectCompanyId, companyName: row.companyName, projectId: row.projectId,
        reason: row.verdict.reason, created: result.created.length, total: result.total,
      });
      if (result.created.length) {
        input.log?.info({ company: row.companyName, projectId: row.projectId, created: result.created.length, reason: row.verdict.reason }, "SIGNALS_REEVALUATED");
      }
    } catch (error) {
      report.failed++;
      report.outcomes.push({
        projectCompanyId: row.projectCompanyId, companyName: row.companyName, projectId: row.projectId,
        reason: row.verdict.reason, created: 0, error: error instanceof Error ? error.message : String(error),
      });
      input.log?.warn({ err: error, company: row.companyName, projectId: row.projectId }, "SIGNAL_REEVALUATION_FAILED");
    }
  }
  return report;
}
