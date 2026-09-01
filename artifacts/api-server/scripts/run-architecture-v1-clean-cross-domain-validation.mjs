import { existsSync } from "node:fs";
import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

if (process.env.NODE_ENV !== "development" || process.env.JYRA_ARCHITECTURE_V1_CLEAN_FRESH_20 !== "YES") {
  throw new Error("Clean Architecture V1 validation requires explicit development-only authorization");
}
assertDevelopmentDatabase("Clean Architecture V1 bounded cross-domain validation");
if (existsSync("JYRA_ARCHITECTURE_V1_CLEAN_CROSS_DOMAIN_VALIDATION_RAW.json")) {
  throw new Error("Clean raw output already exists; refusing to repeat the cohort");
}
await build({
  entryPoints: ["./scripts/architecture-v1-clean-cross-domain-validation-entry.ts"],
  outfile: "/tmp/jyra-architecture-v1-clean-cross-domain-validation.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
await import(`file:///tmp/jyra-architecture-v1-clean-cross-domain-validation.cjs?t=${Date.now()}`);