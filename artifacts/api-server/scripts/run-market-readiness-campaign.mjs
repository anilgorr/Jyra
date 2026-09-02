import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("market readiness operational runner");
await build({
  entryPoints: ["./scripts/run-market-readiness-campaign-entry.ts"],
  outfile: "/tmp/jyra-market-readiness-campaign-runner.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcemap: true,
});
await import(`file:///tmp/jyra-market-readiness-campaign-runner.cjs?t=${Date.now()}`);