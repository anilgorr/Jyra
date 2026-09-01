import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

if (process.env.NODE_ENV !== "development") {
  throw new Error("Cycle 06 validation is development-only (NODE_ENV must equal development).");
}
if (process.env.JYRA_REALITY_CONTACT_ENRICHMENT_ENABLED !== "false") {
  throw new Error("Cycle 06 validation requires JYRA_REALITY_CONTACT_ENRICHMENT_ENABLED=false.");
}
if (process.env.JYRA_REALITY_TEST_NAME || process.env.JYRA_REALITY_TARGET_COMPANIES) {
  throw new Error("Cycle 06 validation must not be invoked as a Reality Test.");
}
assertDevelopmentDatabase("Cycle 06 bounded discovery and five-company research validation");

await build({
  entryPoints: ["./scripts/run-cycle-06-validation-entry.ts"],
  outfile: "/tmp/jyra-cycle-06-validation.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcemap: true,
});
await import(`file:///tmp/jyra-cycle-06-validation.cjs?t=${Date.now()}`);
