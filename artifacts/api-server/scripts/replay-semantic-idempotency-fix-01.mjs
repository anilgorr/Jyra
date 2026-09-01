import { build } from "esbuild";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const integration = spawnSync(process.execPath, ["./scripts/test-opportunity-engine.mjs"], {
  stdio: "inherit",
  env: process.env,
});
if (integration.status !== 0) {
  throw new Error(`Semantic idempotency persisted integration test failed (${integration.status ?? "signal"})`);
}

const output = "/tmp/jyra-semantic-idempotency-fix-01-replay.cjs";
await build({
  entryPoints: ["./scripts/replay-semantic-idempotency-fix-01-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
createRequire(import.meta.url)(output);