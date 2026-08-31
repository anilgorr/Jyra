import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-bright-data-integration.cjs";
await build({
  entryPoints: ["./scripts/run-bright-data-integration-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
createRequire(import.meta.url)(output);