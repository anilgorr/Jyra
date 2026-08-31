import { build } from "esbuild";
import { createRequire } from "node:module";

if (process.env.NODE_ENV === "production") {
  throw new Error("Retrieval Bake-off 01 is development-only");
}

const output = "/tmp/jyra-retrieval-bakeoff-01.cjs";
await build({
  entryPoints: ["./scripts/run-retrieval-bakeoff-01-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});

const require = createRequire(import.meta.url);
require(output);