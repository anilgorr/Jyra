import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = new URL("../../", import.meta.url);
const manifestUrl = new URL("./TASK_117_GENERIC_V2_FREEZE.manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const sha256 = (content) => createHash("sha256").update(content).digest("hex");

for (const entry of manifest.files) {
  const content = await readFile(new URL(`../../${entry.path}`, import.meta.url));
  assert.equal(sha256(content), entry.sha256, `frozen hash mismatch: ${entry.path}`);
}
const schemas = await readFile(new URL("../../artifacts/api-server/src/lib/intelligence-v2/schemas.ts", import.meta.url), "utf8");
for (const [name, value] of Object.entries(manifest.versions)) {
  assert.match(schemas, new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*"${value}"`), `version mismatch: ${name}`);
}
const tests = spawnSync("pnpm", ["run", "test:task-117-intelligence-v2"], {
  cwd: new URL("../../artifacts/api-server/", import.meta.url), encoding: "utf8",
});
process.stdout.write(tests.stdout);
process.stderr.write(tests.stderr);
assert.equal(tests.status, 0, "generic test runner failed");
assert.match(tests.stdout, /PASS 16\/16 Task 117 generic fixtures; external calls: 0/, "generic result is not frozen 16/16 zero-call result");
console.log(`FREEZE VALIDATION PASS ${sha256(await readFile(manifestUrl))}`);