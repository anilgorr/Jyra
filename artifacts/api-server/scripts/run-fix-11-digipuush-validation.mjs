import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

if (process.env.NODE_ENV !== "development" || process.env.JYRA_FIX_11_RUN_FRESH_20 !== "YES") {
  throw new Error("Fix 11 fresh validation requires NODE_ENV=development and JYRA_FIX_11_RUN_FRESH_20=YES");
}
assertDevelopmentDatabase("Fix 11 fresh DigiPuush validation");
await build({
  entryPoints: ["./scripts/fix-11-digipuush-validation-entry.ts"],
  outfile: "/tmp/jyra-fix-11-digipuush-validation.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
await import(`file:///tmp/jyra-fix-11-digipuush-validation.cjs?t=${Date.now()}`);