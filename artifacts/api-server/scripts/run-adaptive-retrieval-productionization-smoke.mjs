import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Adaptive retrieval productionization smoke test");
const output = "/tmp/jyra-adaptive-retrieval-productionization-smoke.cjs";
await build({
  entryPoints: ["./scripts/run-adaptive-retrieval-productionization-smoke-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});
await import(`${pathToFileURL(output).href}?t=${Date.now()}`);