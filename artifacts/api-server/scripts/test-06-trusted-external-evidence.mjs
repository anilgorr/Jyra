import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("REAL DATA TEST 06");

const output = "/tmp/jyra-real-data-test-06.cjs";
await build({
  entryPoints: ["./scripts/test-06-trusted-external-evidence-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});
await import(`${pathToFileURL(output).href}?t=${Date.now()}`);