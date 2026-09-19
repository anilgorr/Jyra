/**
 * Claiming the row that holds a page's text.
 *
 * crawl_pages is append-only, enforced in the database: a trigger raises
 * "crawl_pages records are append-only" on every UPDATE and DELETE. That is
 * the right invariant — what a source said at the moment it was read is the
 * thing every fact is checked against, and it must not be rewritable
 * afterwards.
 *
 * Which makes ON CONFLICT DO UPDATE a trap. Three writers used it to survive
 * the unique index on (company, url, content hash), because one article can
 * yield two events and the second insert used to collide and take a paid cycle
 * down with it. But an upsert on an append-only table does not survive the
 * collision — it turns a unique violation into a trigger exception, at exactly
 * the same moment, and the cycle dies the same way. It only looked fixed
 * because a genuine collision is rare.
 *
 * So: insert, and on conflict read back the row that is already there. The
 * page is the same page — same company, same URL, same content hash — so there
 * is nothing to update and no reason to want to.
 */

import { and, eq } from "drizzle-orm";
import { companyEvidenceTable, crawlPagesTable, db } from "@workspace/db";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CrawlPageClaim = {
  id: string;
  companyId: string;
  sourceUrl: string;
  sourceDomain: string;
  sourceType: typeof crawlPagesTable.$inferInsert.sourceType;
  provider: string;
  observedAt: Date;
  rawContent: string;
  rawContentReference: string;
  normalizedContentHash: string;
};

export async function claimCrawlPage(values: CrawlPageClaim, executor: DbExecutor): Promise<string> {
  const [inserted] = await executor.insert(crawlPagesTable)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: crawlPagesTable.id });
  if (inserted) return inserted.id;
  const [existing] = await executor.select({ id: crawlPagesTable.id })
    .from(crawlPagesTable)
    .where(and(
      eq(crawlPagesTable.companyId, values.companyId),
      eq(crawlPagesTable.sourceUrl, values.sourceUrl),
      eq(crawlPagesTable.normalizedContentHash, values.normalizedContentHash),
    ))
    .limit(1);
  if (!existing) throw new Error(`Crawl page could not be claimed for ${values.sourceUrl}`);
  return existing.id;
}

/**
 * Claiming the one evidence row a crawl page is allowed to have.
 *
 * company_evidence is unique on crawl_page_id: a page is a source, and a
 * source gets one row. Four writers enforced that with a pre-check on
 * (company, url) or (company, url, source type) and then inserted — which
 * holds only while the pre-check's key and the crawl page's key agree. They
 * do not. The page is keyed on (company, url, content hash); the evidence
 * carries a source type the classifier decides per run, and five stored rows
 * already sit on a page whose type disagrees with theirs. Reclassify one URL
 * between two cycles and the pre-check misses, claimCrawlPage returns the
 * page that is already there, and the insert dies on the unique index —
 * taking down a cycle that had already paid for its research.
 *
 * So claim the evidence the same way the page is claimed: insert, and on
 * conflict read back the row that owns the page. The conflict target is
 * named, so a different unique violation still raises rather than being
 * quietly swallowed.
 */
export async function claimCompanyEvidence(
  values: typeof companyEvidenceTable.$inferInsert,
  executor: DbExecutor,
): Promise<{ id: string; created: boolean }> {
  const [inserted] = await executor.insert(companyEvidenceTable)
    .values(values)
    .onConflictDoNothing({ target: companyEvidenceTable.crawlPageId })
    .returning({ id: companyEvidenceTable.id });
  if (inserted) return { id: inserted.id, created: true };
  const [existing] = await executor.select({ id: companyEvidenceTable.id })
    .from(companyEvidenceTable)
    .where(eq(companyEvidenceTable.crawlPageId, values.crawlPageId))
    .limit(1);
  if (!existing) throw new Error(`Evidence could not be claimed for ${values.sourceUrl}`);
  return { id: existing.id, created: false };
}
