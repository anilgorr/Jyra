import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function targetFingerprint(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const identity = [url.protocol, url.hostname, url.port, url.pathname, url.username].join("|");
  return createHash("sha256").update(identity).digest("hex");
}

function expectedDevelopmentFingerprint(): string {
  const candidates = [
    resolve(process.cwd(), "lib/db/.development-db-fingerprint"),
    resolve(process.cwd(), "../../lib/db/.development-db-fingerprint"),
    resolve(process.cwd(), ".development-db-fingerprint"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error("Approved development database fingerprint is unavailable");
  }
  return readFileSync(path, "utf8").trim();
}

export function assertApprovedDevelopmentDatabase(operation: string): void {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error(`${operation} is development-only and cannot run in a deployment environment`);
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  if (targetFingerprint(process.env.DATABASE_URL) !== expectedDevelopmentFingerprint()) {
    throw new Error(`${operation} refused: DATABASE_URL is not the approved development database`);
  }
}