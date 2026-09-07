/**
 * The unit gate: every suite here runs with no database, no API keys and no
 * network, and must pass before a change ships.
 *
 * JYRA had ~200 test scripts and no way to run them, so nobody did. Suites
 * rotted silently (buildHighRecallDiscoveryQueries changed; its test kept
 * asserting the old string for weeks) and a real defect shipped that a single
 * unit check would have caught. This script exists so "the tests pass" is a
 * fact somebody can verify in ten seconds rather than a belief.
 *
 * Suites needing a live database live in test:*:db and are NOT run here.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptsDir = fileURLToPath(new URL(".", import.meta.url));
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

// Placeholder values so module-load-time env assertions in the app graph are
// satisfied. Nothing here is reachable: a suite that actually dials out fails.
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://unit:unit@127.0.0.1:1/unit-suite-placeholder",
  AI_INTEGRATIONS_OPENAI_BASE_URL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "http://127.0.0.1:1/v1",
  AI_INTEGRATIONS_OPENAI_API_KEY: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "unit-suite-placeholder",
};

function discover() {
  return readdirSync(scriptsDir)
    .filter((f) => f.startsWith("test-") && f.endsWith(".mjs"))
    .filter((f) => {
      const src = readFileSync(path.join(scriptsDir, f), "utf8");
      if (!src.includes("node:assert")) return false;          // not an assertion suite
      if (src.includes("assertDevelopmentDatabase")) return false; // needs the real dev DB
      if (src.includes("@requires-database")) return false;    // declared DB-backed
      if (/\bh\.db\b|\bawait db\.|getDb\(|[A-Za-z]+Table\b/.test(src)) return false; // exercises the DB directly
      return true;
    })
    .filter((f) => !only.length || only.some((pattern) => f.includes(pattern)))
    .sort();
}

const run = (file) => new Promise((resolve) => {
  const started = Date.now();
  const child = spawn(process.execPath, [path.join(scriptsDir, file)], {
    cwd: path.join(scriptsDir, ".."), env, stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { out += c; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
  child.on("close", (code) => {
    clearTimeout(timer);
    resolve({ file, ok: code === 0, ms: Date.now() - started, out });
  });
});

const suites = discover();
if (!suites.length) {
  console.error(only.length ? `No unit suites match: ${only.join(", ")}` : "No unit suites found.");
  process.exit(1);
}

console.log(`Running ${suites.length} unit suites (no database, no network)\n`);

const results = [];
for (const file of suites) {
  const result = await run(file);
  results.push(result);
  const name = file.replace(/^test-/, "").replace(/\.mjs$/, "");
  console.log(`${result.ok ? "  PASS" : "  FAIL"}  ${name.padEnd(52)} ${String(result.ms).padStart(6)}ms`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`\n${"=".repeat(72)}`);
  for (const f of failed) {
    console.log(`\nFAILED: ${f.file}\n${"-".repeat(72)}`);
    console.log(f.out.trim().split("\n").slice(-25).join("\n"));
  }
}

const total = results.reduce((sum, r) => sum + r.ms, 0);
console.log(`\n${results.length - failed.length}/${results.length} suites passed in ${(total / 1000).toFixed(1)}s`);
process.exit(failed.length ? 1 : 0);
