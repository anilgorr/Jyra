import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Known Company Provisioning Fix 03A identity-only retest");
await build({
  entryPoints: ["./scripts/known-company-provisioning-fix-03a-entry.ts"],
  outfile: "/tmp/known-company-provisioning-fix-03a.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcemap: true,
});
await import(`file:///tmp/known-company-provisioning-fix-03a.cjs?t=${Date.now()}`);