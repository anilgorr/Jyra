import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-real-data-test-11.cjs";
await build({
  entryPoints: ["./scripts/run-test-11-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
createRequire(import.meta.url)(output);