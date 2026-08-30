import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-real-data-test-08.cjs";
await build({
  entryPoints: ["./scripts/run-test-08-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
const require = createRequire(import.meta.url);
require(output);