import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Query Engine Fix 01 retrieval-only validation");

const output = "/tmp/jyra-query-engine-fix-01.cjs";
await build({
  entryPoints: ["./scripts/run-query-engine-fix-01-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});

await import(`${pathToFileURL(output).href}?t=${Date.now()}`);