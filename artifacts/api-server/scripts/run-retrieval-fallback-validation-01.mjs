import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Retrieval Fallback Validation 01 retrieval-only validation");

const output = "/tmp/jyra-retrieval-fallback-validation-01.cjs";
await build({
  entryPoints: ["./scripts/run-retrieval-fallback-validation-01-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});

await import(`${pathToFileURL(output).href}?t=${Date.now()}`);