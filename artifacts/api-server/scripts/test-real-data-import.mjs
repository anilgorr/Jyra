import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Phase 25A real-data import tests");

const output = "/tmp/jyra-real-data-import-test.cjs";
await build({
  entryPoints: ["./scripts/real-data-import-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
await import(`${output}?t=${Date.now()}`);