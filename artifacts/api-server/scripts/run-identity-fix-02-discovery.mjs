import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Identity Fix 02 production-path discovery replay");
const output = "/tmp/jyra-identity-fix-02-discovery.cjs";
await build({
  entryPoints: ["./scripts/identity-fix-02-discovery-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
await import(`${pathToFileURL(output).href}?t=${Date.now()}`);