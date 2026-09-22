/**
 * Why every signal definition on a project has produced what it has.
 *
 *   DATABASE_URL=... node scripts/report-signal-dormancy.mjs <projectId>
 *
 * A definition that never fires reads exactly like a quiet market. This says
 * which it is. DARK means no fact of its type has ever been produced by any
 * source, which is a statement about the pipeline and never about the market -
 * so it is a roadmap item, not a definition to delete. Exits non-zero when
 * anything is dark, which is the go-live gate.
 */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const projectId = process.argv[2];
if (!projectId) throw new Error("usage: report-signal-dormancy.mjs <projectId>");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

mkdirSync("./node_modules/.cache", { recursive: true });
const outfile = "./node_modules/.cache/jyra-signal-dormancy.cjs";
await build({ entryPoints: ["./scripts/signal-dormancy-entry.ts"], outfile, bundle: true, format: "cjs", platform: "node", external: ["pg-native", "pino-pretty"] });
const lib = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);

const rows = await lib.reportSignalDormancy(projectId);
const pad = (value, width) => String(value).padEnd(width);
for (const row of rows) {
  console.log(`${pad(row.state, 7)} ${pad(row.code.slice(0, 34), 35)} ${row.reason}`);
}
const summary = lib.summariseDormancy(rows);
console.log(`\nfiring=${summary.firing} armed=${summary.armed} dark=${summary.dark}`);
if (summary.dark) console.log(`dark: ${summary.darkCodes.join(", ")}`);
process.exit(summary.dark ? 1 : 0);
