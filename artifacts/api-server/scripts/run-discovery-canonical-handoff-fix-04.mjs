import { build } from "esbuild";
import { createRequire } from "node:module";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Discovery to canonical company handoff Fix 04 replay");
const output = "/tmp/jyra-discovery-canonical-handoff-fix-04-replay.cjs";
await build({
  entryPoints: ["./scripts/discovery-canonical-handoff-fix-04-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
createRequire(import.meta.url)(output);