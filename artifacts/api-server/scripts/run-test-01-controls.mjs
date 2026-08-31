import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("JYRA MVP Reality Test 01 blind controls");
await build({
  entryPoints: ["./scripts/run-test-01-controls-entry.ts"],
  outfile: "/tmp/jyra-mvp-reality-test-01-controls.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcemap: true,
});
await import(`file:///tmp/jyra-mvp-reality-test-01-controls.cjs?t=${Date.now()}`);