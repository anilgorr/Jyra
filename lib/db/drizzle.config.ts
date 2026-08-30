import { defineConfig } from "drizzle-kit";
import path from "path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}
if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Drizzle schema push is disabled in production/deployment environments");
}
const databaseUrl = new URL(process.env.DATABASE_URL);
const targetIdentity = [
  databaseUrl.protocol,
  databaseUrl.hostname,
  databaseUrl.port,
  databaseUrl.pathname,
  databaseUrl.username,
].join("|");
const targetFingerprint = createHash("sha256").update(targetIdentity).digest("hex");
const approvedFingerprint = readFileSync(
  path.join(__dirname, ".development-db-fingerprint"),
  "utf8",
).trim();
if (targetFingerprint !== approvedFingerprint) {
  throw new Error("Drizzle schema push refused: DATABASE_URL is not the approved development database");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
