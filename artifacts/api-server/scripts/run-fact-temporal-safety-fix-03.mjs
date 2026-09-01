import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Fact and temporal safety fix 03 preserved-evidence retest");

const output = "/tmp/jyra-fact-temporal-safety-fix-03.cjs";
await build({
  entryPoints: ["./scripts/run-fact-temporal-safety-fix-03-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
await import(`${pathToFileURL(output).href}?t=${Date.now()}`);