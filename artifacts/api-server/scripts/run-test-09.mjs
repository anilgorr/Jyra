import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-real-data-test-09.cjs";
await build({
  entryPoints: ["./scripts/run-test-09-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
createRequire(import.meta.url)(output);