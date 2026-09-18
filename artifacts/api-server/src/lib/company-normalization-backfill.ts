import { isNull, ne, or, sql } from "drizzle-orm";
import { companiesTable, db } from "@workspace/db";
import { NORMALIZATION_VERSION, normalizedColumnsFor } from "./company-normalization";

/**
 * Brings stored rows up to the current normalisation vocabulary.
 *
 * Normalising on write only helps rows written after the change; the 877
 * companies already on file carry nothing. Rather than a one-shot migration
 * script somebody has to remember to run, this is keyed to
 * NORMALIZATION_VERSION: any row whose stored version is not the current one
 * is stale, so bumping the vocabulary — adding an industry tag, teaching the
 * country table a new spelling — re-derives every affected row by itself.
 *
 * It is bounded and resumable. Boot calls it with a budget so a large table
 * cannot hold the API down, and whatever is left is picked up next time.
 */
export async function backfillCompanyNormalization(
  limit = 1000,
  now: Date = new Date(),
): Promise<{ scanned: number; updated: number; remaining: number }> {
  const stale = or(
    isNull(companiesTable.normalizationVersion),
    ne(companiesTable.normalizationVersion, NORMALIZATION_VERSION),
  );
  const rows = await db.select({
    id: companiesTable.id,
    industry: companiesTable.industry,
    country: companiesTable.country,
    employeeCount: companiesTable.employeeCount,
    employeeRange: companiesTable.employeeRange,
  }).from(companiesTable).where(stale).limit(limit);

  let updated = 0;
  for (const row of rows) {
    const columns = normalizedColumnsFor(row, null, now);
    // updatedAt is deliberately left alone: re-deriving a column from values
    // that did not change is not a change to the company, and the change gate
    // reads that timestamp to decide what to spend money re-researching.
    await db.update(companiesTable).set(columns).where(sql`${companiesTable.id} = ${row.id}`);
    updated += 1;
  }

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(companiesTable).where(stale);
  return { scanned: rows.length, updated, remaining: count };
}
