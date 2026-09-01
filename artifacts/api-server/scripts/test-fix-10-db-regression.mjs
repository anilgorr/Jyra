import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";
import { build } from "esbuild";
import { createRequire } from "node:module";

assertDevelopmentDatabase("Fix10 DB fail-closed regression");
const output = "/tmp/jyra-fix-10-db-regression.cjs";
await build({ entryPoints: ["./scripts/fix-10-db-regression-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node", external: ["pg-native"] });
const { runFix10DbRegression } = createRequire(import.meta.url)(output);
await runFix10DbRegression();
console.log("Fix10 DB fail-closed regression passed.");