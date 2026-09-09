/**
 * Discover ATS boards for every company that lacks one.
 *
 *   DATABASE_URL=... node scripts/backfill-ats-boards.mjs [--limit N] [--force] [--dry-run]
 *
 * Free: no model calls, no paid providers. Prints one line per company and a
 * coverage summary. Safe to re-run — known boards are never re-probed and a
 * miss is only retried after thirty days unless --force.
 */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const outfile = "/tmp/jyra-ats-backfill.cjs";
await build({ entryPoints: ["./scripts/ats-backfill-entry.ts"], outfile, bundle: true, format: "cjs", platform: "node", external: ["pg-native"] });
const lib = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);

const limit = option("--limit") ? Number(option("--limit")) : undefined;
const started = Date.now();
const pad = (s, n) => String(s).padEnd(n);

const report = await lib.backfillAtsHandles({
  limit, force: flag("--force"),
  discover: flag("--dry-run") ? async () => null : undefined,
  onOutcome: (o) => {
    if (o.result === "already_known") return;
    const tag = { found: "FOUND ", missed: "miss  ", failed: "FAIL  ", skipped_recent_miss: "skip  ", skipped_no_domain: "nodom " }[o.result];
    console.log(`${tag} ${pad(o.name, 28)} ${pad(o.domain ?? "-", 26)} ${o.kind ? `${o.kind} via ${o.via}` : o.error ?? ""}`);
  },
});

const known = report.outcomes.filter((o) => o.result === "already_known").length;
console.log("");
console.log(`probed ${report.considered}  found ${report.found}  missed ${report.missed}  failed ${report.failed}  skipped ${report.skipped}`);
console.log(`boards known: ${known} before → ${known + report.found} after, of ${report.outcomes.length} companies  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
process.exit(0);
