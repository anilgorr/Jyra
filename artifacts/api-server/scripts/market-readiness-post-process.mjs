import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("market readiness post-processing");
await build({
  entryPoints: ["./scripts/market-readiness-post-process-entry.ts"],
  outfile: "/tmp/jyra-market-readiness-post-process.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcemap: true,
});
await import(`file:///tmp/jyra-market-readiness-post-process.cjs?t=${Date.now()}`);