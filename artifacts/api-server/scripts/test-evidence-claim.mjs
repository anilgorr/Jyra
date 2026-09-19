/**
 * One source, one evidence row - claimed, not blindly inserted.
 *
 * company_evidence is unique on crawl_page_id. Four writers used to pre-check
 * on (company, url[, source type]) and then insert, which is only safe while
 * that key agrees with the crawl page's (company, url, content hash). It does
 * not: the source type is decided per run, and production already holds five
 * rows whose type disagrees with their page's. Reclassify a URL between two
 * cycles and the pre-check misses, the page claim hits, and the insert dies on
 * the unique index - losing a cycle that had already paid for its research.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL, fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
const stubPath = fileURLToPath(new URL("./fake-db-stub.ts", import.meta.url));
const output = "/tmp/jyra-evidence-claim-test.cjs";
await build({
  entryPoints: ["./scripts/evidence-claim-test-entry.ts"],
  outfile: output, bundle: true, format: "cjs", platform: "node",
  plugins: [{
    name: "fake-workspace-db",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: stubPath }));
    },
  }],
});
const m = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const row = {
  companyId: "company-1",
  crawlPageId: "page-1",
  sourceUrl: "https://linkedin.com/company/kissflow",
  sourceDomain: "linkedin.com",
  sourceType: "public_social",
  provider: "crawl",
  observedAt: new Date("2026-09-19T00:00:00Z"),
  extractedClaim: "excerpt",
  authorityScore: 50, directnessScore: 50, freshnessScore: 50,
  corroborationScore: 0, confidence: 50, status: "VERIFIED",
};

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (error) { failures += 1; console.log(`  FAIL ${name}: ${error.message}`); }
};

// A page nothing has claimed yet: the insert lands and the row is new.
await check("a free page yields a created row", async () => {
  m.installFakeDb((query) => (query.op === "insert" ? [{ id: "evidence-new" }] : []));
  const claimed = await m.claimCompanyEvidence(row, m.db);
  assert.deepEqual(claimed, { id: "evidence-new", created: true });
});

// The collision that killed Exotel's cycle: the page already owns a row, so
// the insert returns nothing and the owner is read back instead.
await check("a taken page yields its existing row, not a crash", async () => {
  m.installFakeDb((query) => (query.op === "insert" ? [] : [{ id: "evidence-existing" }]));
  const claimed = await m.claimCompanyEvidence(row, m.db);
  assert.deepEqual(claimed, { id: "evidence-existing", created: false });
});

// ON CONFLICT DO NOTHING must name its target. Untargeted, it would swallow
// every other unique violation on the table and return a silent no-op.
await check("the conflict target is the crawl page, not every constraint", async () => {
  m.installFakeDb((query) => (query.op === "insert" ? [{ id: "evidence-new" }] : []));
  await m.claimCompanyEvidence(row, m.db);
  const insert = m.fakeQueryLog.find((q) => q.op === "insert");
  const conflict = insert.calls.find(([name]) => name === "onConflictDoNothing");
  assert.ok(conflict, "insert did not use onConflictDoNothing");
  assert.ok(conflict[1][0] && "target" in conflict[1][0], "onConflictDoNothing was not given a target");
});

// Neither branch producing a row means something is wrong with the write, and
// silence there would attach facts to an undefined evidence id.
await check("a claim that neither inserts nor finds an owner raises", async () => {
  m.installFakeDb(() => []);
  await assert.rejects(() => m.claimCompanyEvidence(row, m.db), /could not be claimed/);
});

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nevidence claim: all checks passed");
