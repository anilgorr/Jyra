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
import { crawlPagesTable, db } from "@workspace/db";

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
