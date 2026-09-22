/**
 * Dormancy: why a definition has produced nothing.
 *
 * A definition that never fires reads exactly like a quiet market, and the
 * difference is the whole question. Twelve definitions across the packs were
 * keyed to fact types that had never produced a single row, and finding that
 * out took an afternoon of hand-written SQL.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const d = await loadHermetic("./scripts/signal-dormancy-test-entry.ts", "/tmp/jyra-dormancy-test.cjs");

let passed = 0;
const check = (name, fn) => { fn(); console.log("  ok ", name); passed++; };

const row = (over = {}) => ({
  code: "SAAS_X", factTypes: ["JOB_OPENING"],
  signalsProduced: 0, factsInProject: 0, factsAnywhere: 0, ...over,
});

check("a definition that has produced signals is firing", () => {
  const v = d.classifyDormancy(row({ signalsProduced: 56, factsInProject: 3207, factsAnywhere: 3850 }));
  assert.equal(v.state, "FIRING");
  assert.match(v.reason, /56 signal/);
});

check("DARK is about the pipeline, never about the market", () => {
  // CERTIFICATION carried three definitions and had produced nothing, because
  // no query asked for it - not because nobody was certifying.
  const v = d.classifyDormancy(row({ code: "ISO27001_ACTIVITY", factTypes: ["CERTIFICATION"] }));
  assert.equal(v.state, "DARK");
  assert.match(v.reason, /ever been produced by any source/);
  assert.match(v.reason, /CERTIFICATION/);
});

check("a definition declaring no fact type can never match, and says so", () => {
  const v = d.classifyDormancy(row({ factTypes: [], factsAnywhere: 100 }));
  assert.equal(v.state, "DARK");
  assert.match(v.reason, /no fact type/);
});

check("facts elsewhere but none here is a coverage problem, not a missing extractor", () => {
  // TECHNOLOGY_MENTION: 2,461 facts, 5 of 119 launch-pool companies. Different
  // work from a fact type nothing produces.
  const v = d.classifyDormancy(row({ factTypes: ["TECHNOLOGY_MENTION"], factsAnywhere: 2461 }));
  assert.equal(v.state, "ARMED");
  assert.match(v.reason, /none on this project's companies/);
});

check("facts here and still no signal is the definition's own filter", () => {
  // SAAS_SALES_HIRING_ACCELERATION: 584 HIRING_COUNT facts on the pool, one
  // signal, because the trend rule needs a history six days of data cannot give.
  const v = d.classifyDormancy(row({ factTypes: ["HIRING_COUNT"], factsInProject: 584, factsAnywhere: 796 }));
  assert.equal(v.state, "ARMED");
  assert.match(v.reason, /none matched the definition/);
});

check("the summary is the go-live gate: dark definitions, counted and named", () => {
  const rows = [
    { code: "A", state: "FIRING" }, { code: "B", state: "ARMED" },
    { code: "C", state: "DARK" },   { code: "D", state: "DARK" },
  ];
  const s = d.summariseDormancy(rows);
  assert.deepEqual(s, { firing: 1, armed: 1, dark: 2, darkCodes: ["C", "D"] });
});

console.log(`\nSignal dormancy: ${passed} checks passed.`);
