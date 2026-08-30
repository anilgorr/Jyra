import { build } from "esbuild";

const output = "./.tmp-admin-quality-db-test.cjs";
await build({
  entryPoints: ["./scripts/admin-quality-db-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcemap: "inline",
});
await import(new URL(`../${output.slice(2)}?t=${Date.now()}`, import.meta.url));