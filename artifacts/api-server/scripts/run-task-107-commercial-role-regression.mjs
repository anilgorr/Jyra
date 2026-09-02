import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1"
  || process.env.JYRA_TASK_107_POST_REPAIR_REGRESSION !== "YES") {
  throw new Error("Task 107 regression is development-only and requires explicit authorization");
}
assertDevelopmentDatabase("Task 107 frozen-evidence regression");
const output = "/tmp/jyra-task-107-commercial-role-regression.cjs";
await build({
  entryPoints: ["./scripts/task-107-commercial-role-regression-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
  sourcemap: true,
});
await import(`file://${output}?t=${Date.now()}`);