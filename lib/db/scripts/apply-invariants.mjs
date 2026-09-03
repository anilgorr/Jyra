import pg from "pg";
import { assertDevelopmentDatabase } from "./assert-development.mjs";
import { readInvariantStatements } from "./invariants-sql.mjs";

// Development helper that (re)applies the database invariants after a
// `drizzle-kit push`. The DDL lives in ../drizzle/0001_invariants.sql, the same
// file the production migrator runs, so development and production can never
// drift apart. The file is idempotent; running this script repeatedly is safe.

const databaseUrl = process.env.DATABASE_URL;
assertDevelopmentDatabase("Applying database invariants");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query("BEGIN");
  for (const statement of readInvariantStatements()) {
    await client.query(statement);
  }
  await client.query("COMMIT");
  console.log("Database invariants applied.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
