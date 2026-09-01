import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";
if (process.env.NODE_ENV !== "development" || process.env.JYRA_FIX_07_REPLAY !== "YES") {
  throw new Error("Fix 07 replay requires NODE_ENV=development and JYRA_FIX_07_REPLAY=YES.");
}
if (process.env.JYRA_REALITY_TEST_NAME ||
  process.env.JYRA_REALITY_TARGET_COMPANIES ||
  process.env.JYRA_REALITY_CONTACT_ENRICHMENT_ENABLED !== "false") {
  throw new Error("Fix 07 replay is not a Reality Test and requires contacts disabled.");
}
assertDevelopmentDatabase("Fix 07 bounded canonical-profile replay");
await build({ entryPoints: ["./scripts/canonical-company-profile-fix-07-replay-entry.ts"], outfile: "/tmp/jyra-fix-07-replay.cjs", bundle: true, format: "cjs", platform: "node" });
await import("/tmp/jyra-fix-07-replay.cjs");