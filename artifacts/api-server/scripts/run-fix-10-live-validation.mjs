import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";
import { build } from "esbuild";
import { createRequire } from "node:module";

assertDevelopmentDatabase("Fix10 guarded valid-project lifecycle validation");
const output = "/tmp/jyra-fix-10-live-validation.cjs";
await build({ entryPoints: ["./scripts/fix-10-live-validation-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node", external: ["pg-native"] });
const { runFix10LiveValidation } = createRequire(import.meta.url)(output);
const report = await runFix10LiveValidation();
console.log(`Fix10 validation ${report.executed ? "executed" : "preflight stopped"}: ${report.gate ?? "completed"}`);