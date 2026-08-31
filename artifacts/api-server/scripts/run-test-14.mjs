import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Real Data Test 14 Managed SOC WHEN/WHY");
await build({
  entryPoints: ["./scripts/run-test-14-entry.ts"],
  outfile: "/tmp/jyra-real-data-test-14.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcemap: true,
});
await import(`file:///tmp/jyra-real-data-test-14.cjs?t=${Date.now()}`);