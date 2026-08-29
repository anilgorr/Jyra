import assert from "node:assert/strict";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to test database invariants");
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const trigger = await client.query(`
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'crawl_pages_append_only'
      AND tgenabled <> 'D'
      AND NOT tgisinternal
  `);
  assert.equal(trigger.rowCount, 1, "append-only crawl trigger must exist");

  const opportunityScopeTrigger = await client.query(`
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'opportunities_require_consistent_scope'
      AND tgenabled <> 'D' AND NOT tgisinternal
  `);
  assert.equal(opportunityScopeTrigger.rowCount, 1, "opportunity scope consistency trigger must exist");

  const activeModelIndex = await client.query(`
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'opportunity_model_one_active_per_project'
  `);
  assert.equal(activeModelIndex.rowCount, 1, "one-active-opportunity-model index must exist");

  const capture = await client.query(
    "SELECT id, raw_content FROM crawl_pages ORDER BY created_at LIMIT 1",
  );
  if (capture.rowCount > 0) {
    await assert.rejects(
      client.query(
        "UPDATE crawl_pages SET raw_content = raw_content WHERE id = $1",
        [capture.rows[0].id],
      ),
      (error) =>
        error?.code === "55000" &&
        /append-only/.test(String(error.message)),
    );
  }

  console.log("Database invariant tests passed.");
} finally {
  await client.end();
}