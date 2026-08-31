import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-bright-data-reprocess.cjs";
await build({
  entryPoints: ["./scripts/reprocess-bright-data-integration-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
createRequire(import.meta.url)(output);