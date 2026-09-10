/**
 * One tick of the watch loop, from a shell.
 *
 *   JYRA_WATCH_LOOP_ENABLED=true DATABASE_URL=... node scripts/run-watch-loop.mjs
 *
 * Same code path as POST /api/internal/watch-loop/tick. Prints one line per
 * company and the tick report. Exits non-zero if any cycle failed, so a cron
 * wrapper can tell.
 */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const outfile = "/tmp/jyra-watch-loop.cjs";
await build({ entryPoints: ["./scripts/watch-loop-entry.ts"], outfile, bundle: true, format: "cjs", platform: "node", external: ["pg-native", "pino-pretty"] });
const lib = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);

const report = await lib.runWatchLoopTick({
  repository: new lib.PostgresIntelligenceV2Repository(),
  log: lib.logger,
  settings: lib.watchLoopSettings(),
});
const pad = (s, n) => String(s).padEnd(n);
for (const o of report.outcomes) {
  const tail = o.result === "ran" ? `${o.hasChanges ? "CHANGED " : "same    "} calls=${o.modelCalls} $${(o.costUsd ?? 0).toFixed(3)}` : o.reason ?? "";
  console.log(`${pad(o.result, 24)} ${pad(o.companyName.slice(0, 30), 31)} ${tail}`);
}
console.log(`\nenabled=${report.enabled} due=${report.due} ran=${report.ran} changed=${report.changed} skipped=${report.skipped} failed=${report.failed} spent=$${report.spentUsd.toFixed(3)}`);
process.exit(report.failed ? 1 : 0);
