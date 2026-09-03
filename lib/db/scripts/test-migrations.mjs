import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { INVARIANTS_MIGRATION_PATH, readInvariantStatements } from "./invariants-sql.mjs";

// Deterministic, database-free checks over the migration folder. They prove
// that the invariant DDL can be re-applied safely (every trigger is dropped
// before it is created, every constraint is guarded, functions are replaced,
// indexes are conditional) and that the journal and baseline are coherent.

const migrationsDir = fileURLToPath(new URL("../drizzle/", import.meta.url));
const journal = JSON.parse(readFileSync(`${migrationsDir}meta/_journal.json`, "utf8"));
assert.equal(journal.dialect, "postgresql");
assert.ok(journal.entries.length >= 2, "journal must list the baseline and the invariants migration");
for (const [index, entry] of journal.entries.entries()) {
  assert.equal(entry.idx, index, `journal entry ${entry.tag} must be sequential`);
  assert.ok(existsSync(`${migrationsDir}${entry.tag}.sql`), `${entry.tag}.sql must exist`);
  if (index > 0) assert.ok(entry.when > journal.entries[index - 1].when, "journal timestamps must increase");
}
assert.equal(journal.entries[0].tag, "0000_baseline");
assert.equal(journal.entries[1].tag, "0001_invariants");
assert.ok(existsSync(`${migrationsDir}meta/0000_snapshot.json`), "baseline snapshot must exist for future generate runs");

const baseline = readFileSync(`${migrationsDir}0000_baseline.sql`, "utf8");
assert.match(baseline, /CREATE INDEX "market_readiness_attempt_cohort_item_idx" ON "market_readiness_processing_attempts" USING btree \("cohort_item_id"\)/,
  "processing attempts must index cohort_item_id (R10)");

const sql = readFileSync(INVARIANTS_MIGRATION_PATH, "utf8");
const statements = readInvariantStatements();
assert.ok(statements.length >= 1);
assert.equal(statements.join("\n").includes("statement-breakpoint"), false);

const stripComments = (text) => text.replace(/--[^\n]*/g, "");
const body = stripComments(sql);

// 1. Every CREATE [CONSTRAINT] TRIGGER is preceded by DROP TRIGGER IF EXISTS
//    for the same trigger on the same table.
const createTrigger = /CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+(\w+)\s+(?:BEFORE|AFTER|INSTEAD OF)[\s\S]*?\bON\s+(\w+)/gi;
let triggerCount = 0;
for (const match of body.matchAll(createTrigger)) {
  triggerCount += 1;
  const [, name, table] = match;
  const before = body.slice(0, match.index);
  const drop = new RegExp(`DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${name}\\s+ON\\s+${table}\\b`, "i");
  assert.match(before, drop, `trigger ${name} on ${table} must be dropped before it is created`);
}
assert.ok(triggerCount >= 30, `expected the invariant trigger set, found ${triggerCount}`);

// 2. Triggers created dynamically inside DO blocks follow the same rule.
const doBlocks = [...body.matchAll(/DO\s+\$\$([\s\S]*?)\$\$;/g)].map((match) => match[1]);
assert.ok(doBlocks.length >= 3, "expected DO blocks for scope, freeze and delete triggers");
let dynamicTriggerCount = 0;
for (const block of doBlocks) {
  for (const match of block.matchAll(/EXECUTE\s+format\('CREATE\s+TRIGGER\s+%I\b/gi)) {
    dynamicTriggerCount += 1;
    const before = block.slice(0, match.index);
    assert.match(before, /EXECUTE\s+format\('DROP\s+TRIGGER\s+IF\s+EXISTS\s+%I\s+ON\s+%I'/i,
      "dynamically created triggers must be dropped first");
  }
}
assert.ok(dynamicTriggerCount >= 3, "expected dynamic trigger loops");

// 3. Every ADD CONSTRAINT sits inside a DO block guarded by a pg_constraint lookup.
const addConstraints = [...body.matchAll(/ADD\s+CONSTRAINT\s+(\w+)/gi)];
assert.ok(addConstraints.length >= 1, "the exactly-200 constraint must be present");
for (const match of addConstraints) {
  const name = match[1];
  const block = doBlocks.find((candidate) => candidate.includes(`ADD CONSTRAINT ${name}`));
  assert.ok(block, `ADD CONSTRAINT ${name} must live inside a DO block`);
  assert.match(block, new RegExp(`IF\\s+NOT\\s+EXISTS\\s*\\(\\s*SELECT\\s+1\\s+FROM\\s+pg_constraint\\s+WHERE\\s+conname\\s*=\\s*'${name}'`, "i"),
    `ADD CONSTRAINT ${name} must be guarded by a pg_constraint existence check`);
}
const outsideDoBlocks = body.replace(/DO\s+\$\$[\s\S]*?\$\$;/g, "");
assert.ok(!/\bADD\s+CONSTRAINT\b/i.test(outsideDoBlocks), "no unguarded top-level ALTER TABLE ... ADD CONSTRAINT");

// 4. Functions are replaced, indexes are conditional, DROP CONSTRAINT is conditional.
for (const match of body.matchAll(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(\w+)/gi)) {
  assert.ok(match[1], `function ${match[2]} must use CREATE OR REPLACE`);
}
for (const match of body.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) {
  assert.ok(match[1], `index ${match[2]} must use IF NOT EXISTS`);
}
for (const match of body.matchAll(/DROP\s+CONSTRAINT\s+(IF\s+EXISTS\s+)?(\w+)/gi)) {
  assert.ok(match[1], `DROP CONSTRAINT ${match[2]} must use IF EXISTS`);
}
assert.ok(!/\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDROP\s+COLUMN\b/i.test(body), "invariants never destroy data");

// 5. Frozen-campaign immutability covers DELETE on the campaign and on every
//    table that carries a campaign_id (R6).
assert.match(body, /CREATE TRIGGER market_readiness_campaigns_freeze_deletes\s+BEFORE DELETE ON market_readiness_campaigns/);
const childTables = [...baseline.matchAll(/CREATE TABLE "(market_readiness_\w+)" \(([\s\S]*?)\n\);/g)]
  .filter(([, , columns]) => /"campaign_id" uuid/.test(columns))
  .map(([, table]) => table);
assert.ok(childTables.length >= 12, `expected the market readiness child tables, found ${childTables.length}`);
const deleteBlock = doBlocks.find((block) => block.includes("reject_market_readiness_frozen_child_delete"));
assert.ok(deleteBlock, "frozen child delete trigger loop must exist");
for (const table of childTables) {
  assert.ok(deleteBlock.includes(`'${table}'`), `${table} must reject DELETE while its campaign is frozen`);
}
const snapshotFunction = body.slice(
  body.indexOf("CREATE OR REPLACE FUNCTION reject_market_readiness_prediction_snapshot_mutation()"),
  body.indexOf("DROP TRIGGER IF EXISTS market_readiness_prediction_snapshots_append_only"),
);
assert.match(snapshotFunction, /pg_trigger_depth\(\) > 1/);
assert.match(snapshotFunction, /frozen_at/, "cascade deletes of snapshots must consult the campaign freeze state");
// The only bypass is an explicit transaction-local setting.
assert.match(body, /current_setting\('jyra\.allow_frozen_teardown', true\)/);

// 6. The development helper runs the identical file.
const applyInvariants = readFileSync(fileURLToPath(new URL("./apply-invariants.mjs", import.meta.url)), "utf8");
assert.match(applyInvariants, /readInvariantStatements/, "apply-invariants.mjs must execute the migration SQL, not a private copy");
assert.doesNotMatch(applyInvariants, /CREATE\s+TRIGGER/i, "apply-invariants.mjs must not carry its own DDL");

// 7. drizzle.config.ts writes migrations to ./drizzle and only touches a
//    database when DATABASE_URL is present (generate stays offline).
const config = readFileSync(fileURLToPath(new URL("../drizzle.config.ts", import.meta.url)), "utf8");
assert.match(config, /out:\s*"\.\/drizzle"/);
assert.match(config, /databaseUrl \? \{ dbCredentials/);
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
assert.equal(pkg.scripts.migrate, "node ./scripts/migrate.mjs");
assert.match(pkg.scripts["push-force"], /confirm-push-force\.mjs/, "push --force must require explicit confirmation");

console.log(`Migration checks passed: ${triggerCount} static + ${dynamicTriggerCount} dynamic trigger definitions, ${addConstraints.length} guarded constraint(s), ${childTables.length} frozen-delete guarded tables.`);
