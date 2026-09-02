import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1"
  || process.env.JYRA_TASK_106_POST_REPAIR_REGRESSION !== "YES") {
  throw new Error("Task 106 regression is development-only and requires explicit authorization");
}
assertDevelopmentDatabase("Task 106 frozen-evidence regression");
const output = "/tmp/jyra-task-106-explicit-who-regression.cjs";
await build({
  entryPoints: ["./scripts/task-106-explicit-who-regression-entry.ts"],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["pg-native"],
  sourcemap: true,
});
await import(`file://${output}?t=${Date.now()}`);