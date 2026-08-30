import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Tavily evidence-quality reprocessing");

const output = "/tmp/jyra-tavily-evidence-quality.cjs";

await build({
  entryPoints: ["./scripts/tavily-evidence-quality-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});

await import(`${pathToFileURL(output).href}?t=${Date.now()}`);