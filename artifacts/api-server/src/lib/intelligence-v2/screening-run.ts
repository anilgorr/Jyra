/**
 * Running the screen against a project, and acting on what it says.
 *
 * The decision logic is in `screening.ts` and is pure. This is the part that
 * knows where the inputs live: the project's latest business twin for the
 * policy, the screened companies for the subjects, their technology facts and
 * active signals for the evidence.
 *
 * Reading and acting are separate calls on purpose. A screen that archived 154
 * companies the moment it was run would be asking someone to trust arithmetic
 * they had not seen; the numbers should be looked at first, and the same
 * numbers should still be there when the button is pressed.
 */

import { sellerNamedCompetitors } from "./seller-named-competitors";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  businessTwinVersionsTable,
  companiesTable,
  companyFactsTable,
  db,
  projectCompaniesTable,
  signalsTable,
  type Project,
} from "@workspace/db";
import { assertWatchPoolCapacity, screeningPoolCapacity, watchPoolCapacity } from "../plans";
import {
  screenCompanies,
  sellerOfferingFromBusinessTwin,
  targetCountriesFromBusinessTwin,
  type ScreeningInput,
  type ScreeningPolicy,
  type ScreeningReport,
} from "./screening";
import type { TechnologyCategory } from "./vendor-technographics";

export const IMPORT_FACT_EXTRACTOR = "vendor-technographics@1";

export class ScreeningUnavailableError extends Error {
  readonly code = "SCREENING_UNAVAILABLE";
}

/**
 * The policy, from the project's own business twin.
 *
 * Refused rather than defaulted when the twin has no offering. A screen with no
 * idea what the seller sells cannot find a competitor, so it would pass every
 * agency on the list and look like it was working — the same shape of failure
 * as the target-industries bug, and worth failing loudly instead.
 */
export async function screeningPolicyForProject(project: Project): Promise<ScreeningPolicy> {
  const [twin] = await db
    .select()
    .from(businessTwinVersionsTable)
    .where(and(
      eq(businessTwinVersionsTable.projectId, project.id),
      eq(businessTwinVersionsTable.status, "ready"),
    ))
    .orderBy(desc(businessTwinVersionsTable.version))
    .limit(1);
  if (!twin) {
    throw new ScreeningUnavailableError(
      "This project has no ready Business Twin, so there is nothing to screen against.",
    );
  }
  const interpretation = (twin.aiInterpretation ?? null) as Record<string, unknown> | null;
  const rawAnswers = (twin.rawAnswers ?? {}) as Record<string, unknown>;
  const sellerIndustry = typeof rawAnswers.industry === "string" ? rawAnswers.industry : null;
  const companyName = typeof rawAnswers.companyName === "string" ? rawAnswers.companyName : null;

  const offering = sellerOfferingFromBusinessTwin({ interpretation, sellerIndustry, companyName });
  if (!offering) {
    throw new ScreeningUnavailableError(
      "The Business Twin does not describe what you sell, so a competitor cannot be told from a prospect.",
    );
  }
  return {
    offering,
    targetCountries: targetCountriesFromBusinessTwin(interpretation),
    /* The seller's own industry, as the seller stated it. A company filed under
     * the same label is a peer, and on the first real import this was the
     * largest single exclusion — 98 of 790. */
    sellerIndustries: sellerIndustry ? [sellerIndustry] : [],
    /* Read straight off the Twin, where the seller answered the question. */
    namedCompetitors: sellerNamedCompetitors(rawAnswers.competitorsOrAlternatives ?? interpretation?.competitors_or_alternatives),
  };
}

async function screeningInputsForProject(projectId: string): Promise<ScreeningInput[]> {
  const rows = await db
    .select({
      projectCompanyId: projectCompaniesTable.id,
      companyId: companiesTable.id,
      canonicalName: companiesTable.canonicalName,
      domain: companiesTable.domain,
      industry: companiesTable.industry,
      country: companiesTable.country,
      employeeRange: companiesTable.employeeRange,
      description: companiesTable.description,
      activeSignals: sql<number>`(
        select count(*)::int from ${signalsTable}
        where ${signalsTable.companyId} = ${companiesTable.id}
          and ${signalsTable.projectId} = ${projectCompaniesTable.projectId}
          and ${signalsTable.status} = 'ACTIVE'
      )`,
    })
    .from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .where(and(
      eq(projectCompaniesTable.projectId, projectId),
      eq(projectCompaniesTable.status, "screening"),
    ));
  if (!rows.length) return [];

  /* One query for every company's technologies rather than one per company.
   * 790 round trips is how the first fact backfill timed out a whole tick. */
  const facts = await db
    .select({
      companyId: companyFactsTable.companyId,
      structuredValue: companyFactsTable.structuredValue,
    })
    .from(companyFactsTable)
    .where(and(
      inArray(companyFactsTable.companyId, rows.map((row) => row.companyId)),
      eq(companyFactsTable.extractorVersion, IMPORT_FACT_EXTRACTOR),
    ));

  const byCompany = new Map<string, Array<{ product: string; categories: TechnologyCategory[] }>>();
  for (const fact of facts) {
    const value = fact.structuredValue as { product?: unknown; categories?: unknown };
    if (typeof value.product !== "string") continue;
    const categories = Array.isArray(value.categories)
      ? (value.categories.filter((entry) => typeof entry === "string") as TechnologyCategory[])
      : [];
    byCompany.set(fact.companyId, [
      ...(byCompany.get(fact.companyId) ?? []),
      { product: value.product, categories },
    ]);
  }

  return rows.map((row) => ({
    company: {
      projectCompanyId: row.projectCompanyId,
      companyId: row.companyId,
      canonicalName: row.canonicalName,
      domain: row.domain,
      industry: row.industry,
      country: row.country,
      employeeRange: row.employeeRange,
      description: row.description,
    },
    technologies: byCompany.get(row.companyId) ?? [],
    activeSignals: Number(row.activeSignals ?? 0),
  }));
}

export type ScreeningRun = ScreeningReport & {
  watchPool: { used: number; limit: number; remaining: number };
  screeningPool: { used: number; limit: number; remaining: number };
  /** The score at the last slot the watch pool could take, or null if it fits. */
  cutLineScore: number | null;
};

export async function runScreening(project: Project): Promise<ScreeningRun> {
  const [policy, inputs, watch, screening] = await Promise.all([
    screeningPolicyForProject(project),
    screeningInputsForProject(project.id),
    watchPoolCapacity(project.organizationId),
    screeningPoolCapacity(project.organizationId),
  ]);
  const report = screenCompanies(inputs, policy);
  return {
    ...report,
    watchPool: {
      used: watch.used,
      limit: watch.plan.watchPoolSize,
      remaining: watch.remaining,
    },
    screeningPool: {
      used: screening.used,
      limit: screening.used + screening.remaining,
      remaining: screening.remaining,
    },
    cutLineScore: report.ranked.length > watch.remaining
      ? report.ranked[watch.remaining - 1]?.score ?? null
      : null,
  };
}

export type ApplyScreeningInput = {
  /** Archive everything the screen disqualified. */
  archiveDisqualified: boolean;
  /**
   * Archive kept companies scoring below this. Null leaves them in screening.
   *
   * Archiving is what frees screening room for the next upload, which is the
   * point: a pool of 1,000 full of companies with nothing to say is a pool that
   * cannot take a better list.
   */
  archiveBelowScore: number | null;
  /** Promote the best N into the watched pool. Bounded by the plan. */
  promoteTop: number;
};

export type ApplyScreeningResult = {
  archived: number;
  promoted: number;
  watchPool: { used: number; limit: number; remaining: number };
  screeningPool: { used: number; limit: number; remaining: number };
};

export async function applyScreening(
  project: Project,
  input: ApplyScreeningInput,
): Promise<ApplyScreeningResult> {
  const run = await runScreening(project);

  const toArchive = [
    ...(input.archiveDisqualified ? run.disqualified : []),
    ...(input.archiveBelowScore === null
      ? []
      : run.ranked.filter((row) => row.score < input.archiveBelowScore!)),
  ].map((row) => row.projectCompanyId);

  /* Promotion is taken from the ranking AFTER the archive list is computed, so
   * a company cannot be archived and promoted by the same call however the two
   * thresholds are set. */
  const archiving = new Set(toArchive);
  const toPromote = run.ranked
    .filter((row) => !archiving.has(row.projectCompanyId))
    .slice(0, Math.max(0, input.promoteTop))
    .map((row) => row.projectCompanyId);

  /* Checked before anything is written. Being told the pool is full is more
   * useful than finding out after 154 companies have been archived. */
  if (toPromote.length) {
    await assertWatchPoolCapacity(project.organizationId, toPromote.length);
  }

  await db.transaction(async (tx) => {
    if (toArchive.length) {
      await tx
        .update(projectCompaniesTable)
        .set({ status: "archived", updatedAt: new Date() })
        .where(and(
          eq(projectCompaniesTable.projectId, project.id),
          inArray(projectCompaniesTable.id, toArchive),
        ));
    }
    if (toPromote.length) {
      await tx
        .update(projectCompaniesTable)
        .set({ status: "candidate", updatedAt: new Date() })
        .where(and(
          eq(projectCompaniesTable.projectId, project.id),
          inArray(projectCompaniesTable.id, toPromote),
        ));
    }
  });

  const [watch, screening] = await Promise.all([
    watchPoolCapacity(project.organizationId),
    screeningPoolCapacity(project.organizationId),
  ]);
  return {
    archived: toArchive.length,
    promoted: toPromote.length,
    watchPool: { used: watch.used, limit: watch.plan.watchPoolSize, remaining: watch.remaining },
    screeningPool: {
      used: screening.used,
      limit: screening.used + screening.remaining,
      remaining: screening.remaining,
    },
  };
}
