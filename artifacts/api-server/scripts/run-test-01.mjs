import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("JYRA MVP Reality Test 01");
await build({
  entryPoints: ["./scripts/run-test-01-entry.ts"],
  outfile: "/tmp/jyra-mvp-reality-test-01.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcemap: true,
});
await import(`file:///tmp/jyra-mvp-reality-test-01.cjs?t=${Date.now()}`);