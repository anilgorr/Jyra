import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function targetFingerprint(databaseUrl) {
  const url = new URL(databaseUrl);
  const identity = [url.protocol, url.hostname, url.port, url.pathname, url.username].join("|");
  return createHash("sha256").update(identity).digest("hex");
}

export function assertDevelopmentDatabase(operation) {
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error(`${operation} is development-only and cannot run in a deployment environment`);
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  const expected = readFileSync(
    new URL("../.development-db-fingerprint", import.meta.url),
    "utf8",
  ).trim();
  if (targetFingerprint(process.env.DATABASE_URL) !== expected) {
    throw new Error(`${operation} refused: DATABASE_URL is not the approved development database`);
  }
}