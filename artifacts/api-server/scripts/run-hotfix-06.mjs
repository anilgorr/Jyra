import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-hotfix-06.cjs";
await build({
  entryPoints: ["./scripts/run-hotfix-06-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
const require = createRequire(import.meta.url);
require(output);