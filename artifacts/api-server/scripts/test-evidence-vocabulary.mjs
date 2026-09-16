/**
 * The database and the API must agree on what an attribution can say.
 *
 * `entity_status` and `source_classification` are now Postgres enums, so a bad
 * write fails at the insert. That only helps if the enum and the API schema
 * list the SAME values. If they drift, the failure comes back - a value the
 * database accepts and the endpoint refuses is a 500 on read; a value the
 * endpoint expects and the database refuses is a write that dies in production
 * for a reason no test predicted.
 *
 * So this suite compares the two ends directly. It reads the pgEnum's declared
 * values out of the Drizzle column definition - not a copy of the list - and
 * the API's values out of the generated Zod schema, and asserts set equality
 * both ways. Neither end can move alone.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const m = await loadHermetic(
  "./scripts/evidence-vocabulary-test-entry.ts",
  "/tmp/jyra-evidence-vocabulary.cjs",
);

/** The values the generated API schema accepts for one field. */
function apiValues(field) {
  const shape = m.ListCompanyEvidenceResponseItem.shape[field];
  assert.ok(shape, `the API schema has no ${field} field`);
  const options = shape.options ?? shape._def?.values ?? shape._def?.entries;
  assert.ok(options, `could not read the enum values of ${field}`);
  return [...(Array.isArray(options) ? options : Object.values(options))].sort();
}

const cases = [
  {
    field: "entityStatus",
    column: "entity_status",
    dbEnum: m.evidenceEntityStatusEnum,
    constant: m.EVIDENCE_ENTITY_STATUSES,
  },
  {
    field: "sourceClassification",
    column: "source_classification",
    dbEnum: m.evidenceSourceClassificationEnum,
    constant: m.EVIDENCE_SOURCE_CLASSIFICATIONS,
  },
];

let checks = 0;
for (const { field, column, dbEnum, constant } of cases) {
  // The pgEnum's own declared values, read from the Drizzle builder rather than
  // from the array that was passed to it - so a hand-edited enum is caught.
  const declared = [...(dbEnum.enumValues ?? dbEnum("x").enumValues)].sort();
  assert.ok(declared.length > 0, `${column}: pgEnum declares no values`);

  assert.deepEqual(
    declared,
    [...constant].sort(),
    `${column}: the pgEnum and its exported constant disagree`,
  );
  checks += 1;

  assert.deepEqual(
    declared,
    apiValues(field),
    `${column}: Postgres would accept ${JSON.stringify(declared)} but the API schema accepts ${JSON.stringify(apiValues(field))} - one end has moved without the other, which is how "MATCHED" reached production`,
  );
  checks += 1;
}

// The specific value that caused the outage stays rejected by both ends.
assert.ok(
  !m.EVIDENCE_ENTITY_STATUSES.includes("MATCHED"),
  "MATCHED is back in the entity-status vocabulary",
);
checks += 1;

console.log(`evidence vocabulary: ${checks} checks passed`);
