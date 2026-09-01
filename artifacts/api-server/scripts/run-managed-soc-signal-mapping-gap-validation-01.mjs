import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

if (process.env.NODE_ENV !== "development") {
  throw new Error("Managed SOC signal mapping gap validation is development-only");
}
assertDevelopmentDatabase("Managed SOC signal mapping gap validation 01");

const output = "/tmp/jyra-managed-soc-signal-mapping-gap-validation-01.cjs";
await build({
  entryPoints: ["./scripts/run-managed-soc-signal-mapping-gap-validation-01-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
await import(`${pathToFileURL(output).href}?t=${Date.now()}`);