import { build } from "esbuild";
import { createRequire } from "node:module";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("MVP Fix Cycle 02 read-only pre-fix autopsy");
const output = "/tmp/jyra-mvp-fix-cycle-02-autopsy.cjs";
await build({
  entryPoints: ["./scripts/mvp-fix-cycle-02-autopsy-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
createRequire(import.meta.url)(output);