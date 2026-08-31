import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Profile Resolution Fix 02A normal-path replay");
const output = "/tmp/jyra-profile-resolution-fix-02a-discovery.cjs";
await build({
  entryPoints: ["./scripts/profile-resolution-fix-02a-discovery-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
await import(`${pathToFileURL(output).href}?t=${Date.now()}`);