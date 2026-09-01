import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Acceptance runner signal-pack preflight hotfix 02A");
await build({
  entryPoints: ["./scripts/test-acceptance-runner-preflight-02a-entry.ts"],
  outfile: "/tmp/jyra-acceptance-runner-preflight-02a.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcemap: true,
});
await import(`file:///tmp/jyra-acceptance-runner-preflight-02a.cjs?t=${Date.now()}`);