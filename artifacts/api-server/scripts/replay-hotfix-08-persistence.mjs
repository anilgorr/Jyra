import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-hotfix-08-persistence.cjs";
await build({
  entryPoints: ["./scripts/replay-hotfix-08-persistence-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
createRequire(import.meta.url)(output);