// Records the current DATABASE_URL as the approved *development* database so
// `pnpm push` (drizzle-kit push) is allowed against it. `migrate` never needs
// this — it is the production-safe path. Refuses in deployment environments.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("approve-development-db is development-only");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
  throw new Error(`Refusing to approve a non-local database host (${url.hostname}) for push`);
}
const identity = [url.protocol, url.hostname, url.port, url.pathname, url.username].join("|");
const fingerprint = createHash("sha256").update(identity).digest("hex");
writeFileSync(new URL("../.development-db-fingerprint", import.meta.url), `${fingerprint}\n`);
console.log(`Approved ${url.hostname}:${url.port || "5432"}${url.pathname} for drizzle-kit push.`);
