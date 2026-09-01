import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("50-company Reality Test 02 harness preparation");
await build({
  entryPoints: ["./scripts/test-reality-test-02-harness-preparation-entry.ts"],
  outfile: "/tmp/jyra-reality-test-02-harness-preparation.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcemap: true,
});
await import(`file:///tmp/jyra-reality-test-02-harness-preparation.cjs?t=${Date.now()}`);