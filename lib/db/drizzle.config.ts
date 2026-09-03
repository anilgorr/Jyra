import { defineConfig } from "drizzle-kit";
import path from "path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// `drizzle-kit generate` is an offline operation: it diffs ./src/schema against
// ./drizzle/meta and needs no database. `drizzle-kit push` (development only)
// needs DATABASE_URL and is fenced to the approved development database.
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("Drizzle schema push is disabled in production/deployment environments; use `pnpm --dir lib/db migrate`");
  }
  const url = new URL(databaseUrl);
  const targetIdentity = [url.protocol, url.hostname, url.port, url.pathname, url.username].join("|");
  const targetFingerprint = createHash("sha256").update(targetIdentity).digest("hex");
  const approvedFingerprint = readFileSync(
    path.join(__dirname, ".development-db-fingerprint"),
    "utf8",
  ).trim();
  if (targetFingerprint !== approvedFingerprint) {
    throw new Error("Drizzle schema push refused: DATABASE_URL is not the approved development database");
  }
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: "./drizzle",
  dialect: "postgresql",
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
});
