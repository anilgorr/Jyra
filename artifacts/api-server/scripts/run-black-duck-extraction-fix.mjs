import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Black Duck extraction repair validation");
const output = "/tmp/jyra-black-duck-extraction-fix.cjs";
await build({
  entryPoints: ["./scripts/run-black-duck-extraction-fix-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
await import(`${pathToFileURL(output).href}?t=${Date.now()}`);