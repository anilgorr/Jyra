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
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
// Inside the package, not /tmp: the logger's pino-pretty transport is loaded
// by name at runtime, and pino resolves it relative to the bundle. From /tmp
// there is no node_modules to walk up to and the process dies on boot.
mkdirSync("./node_modules/.cache", { recursive: true });
const outfile = "./node_modules/.cache/jyra-watch-loop.cjs";
await build({ entryPoints: ["./scripts/watch-loop-entry.ts"], outfile, bundle: true, format: "cjs", platform: "node", external: ["pg-native", "pino-pretty"] });
const lib = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);

const report = await lib.runWatchLoopTick({
  repository: new lib.PostgresIntelligenceV2Repository(),
  log: lib.logger,
  settings: lib.watchLoopSettings(),
});
const pad = (s, n) => String(s).padEnd(n);
for (const o of report.outcomes) {
  const tail = o.result === "ran" ? `${o.hasChanges ? "CHANGED " : "same    "} calls=${o.modelCalls} $${(o.costUsd ?? 0).toFixed(3)}` : o.gate?.reason ?? o.reason ?? "";
  console.log(`${pad(o.result, 14)} ${pad(o.tier ?? "", 6)} ${pad(o.companyName.slice(0, 30), 31)} ${tail}`);
}
console.log(`\nenabled=${report.enabled} due=${report.due} checked=${report.checked} unchanged=${report.unchanged} deferred=${report.deferred} ran=${report.ran} changed=${report.changed} skipped=${report.skipped} failed=${report.failed} gate=$${report.gateSpentUsd.toFixed(4)} spent=$${report.spentUsd.toFixed(3)}`);
process.exit(report.failed ? 1 : 0);
