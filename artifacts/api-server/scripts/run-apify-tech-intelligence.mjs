import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-apify-tech-intelligence.cjs";
await build({
  entryPoints: ["./scripts/run-apify-tech-intelligence-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
createRequire(import.meta.url)(output);