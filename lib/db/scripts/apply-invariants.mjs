import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply database invariants");
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query(`
    CREATE OR REPLACE FUNCTION reject_crawl_page_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'crawl_pages records are append-only'
        USING ERRCODE = '55000';
    END;
    $$;

    DROP TRIGGER IF EXISTS crawl_pages_append_only ON crawl_pages;

    CREATE TRIGGER crawl_pages_append_only
    BEFORE UPDATE OR DELETE ON crawl_pages
    FOR EACH ROW
    EXECUTE FUNCTION reject_crawl_page_mutation();
  `);
  console.log("Database invariants applied.");
} finally {
  await client.end();
}