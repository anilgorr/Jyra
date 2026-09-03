import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The invariant DDL shared by the production migrator and the dev helper. */
export const INVARIANTS_MIGRATION_PATH = fileURLToPath(
  new URL("../drizzle/0001_invariants.sql", import.meta.url),
);

export function readInvariantStatements(path = INVARIANTS_MIGRATION_PATH) {
  return readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
