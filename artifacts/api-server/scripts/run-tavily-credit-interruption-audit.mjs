import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-tavily-credit-interruption-audit.cjs";
await build({
  entryPoints: ["./scripts/tavily-credit-interruption-audit-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
const require = createRequire(import.meta.url);
require(output);