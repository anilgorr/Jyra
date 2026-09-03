import pg from "pg";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Production-safe schema migration. It applies, in order and inside one
// transaction, every SQL file listed in ./drizzle/meta/_journal.json that the
// target database has not yet recorded in drizzle.__drizzle_migrations. It
// never diffs live schema, never drops anything on its own, and is safe to
// re-run: a fully migrated database is a no-op.
//
//   DATABASE_URL=... node ./scripts/migrate.mjs
//   pnpm --dir lib/db migrate

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

async function appliedCount() {
  const result = await pool.query(`
    select count(*)::int as count
    from information_schema.tables
    where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
  `);
  if (result.rows[0]?.count === 0) return 0;
  const applied = await pool.query(`select count(*)::int as count from drizzle.__drizzle_migrations`);
  return applied.rows[0]?.count ?? 0;
}

try {
  const before = await appliedCount();
  await migrate(drizzle(pool), { migrationsFolder });
  const after = await appliedCount();
  console.log(
    after > before
      ? `Applied ${after - before} migration(s); ${after} total recorded.`
      : `Database is up to date (${after} migration(s) recorded).`,
  );
} finally {
  await pool.end();
}
