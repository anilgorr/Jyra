import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-task-113-identity-bootstrap-integration.cjs";
await build({
  entryPoints: ["./scripts/task-113-identity-bootstrap-integration-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});
await import(`${pathToFileURL(output).href}?t=${Date.now()}`);