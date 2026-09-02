import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1"
  || process.env.JYRA_TASK_109_POST_REPAIR_REGRESSION !== "YES") {
  throw new Error("Task 109 regression is development-only and requires explicit authorization");
}
assertDevelopmentDatabase("Task 109 frozen-evidence regression");
const output = "/tmp/jyra-task-109-evidence-to-icp-regression.cjs";
await build({
  entryPoints: ["./scripts/task-109-evidence-to-icp-regression-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
  sourcemap: true,
});
await import(`file://${output}?t=${Date.now()}`);