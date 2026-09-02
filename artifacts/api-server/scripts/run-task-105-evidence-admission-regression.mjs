import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

if (process.env.NODE_ENV !== "development" || process.env.JYRA_TASK_105_POST_REPAIR_REGRESSION !== "YES") {
  throw new Error("Task 105 regression requires explicit development-only authorization");
}
assertDevelopmentDatabase("Task 105 frozen-evidence regression");
await build({
  entryPoints: ["./scripts/task-105-evidence-admission-regression-entry.ts"],
  outfile: "/tmp/jyra-task-105-evidence-admission-regression.cjs",
  bundle: true, format: "cjs", platform: "node", external: ["pg-native"],
});
await import(`file:///tmp/jyra-task-105-evidence-admission-regression.cjs?t=${Date.now()}`);