/**
 * How many people a company is hiring, and whether that number is going up.
 *
 * SECURITY_HIRING_ACCELERATION is the strongest definition in the catalogue —
 * strength 88 — and it had never fired, because nothing in JYRA has ever
 * written a HIRING_COUNT fact. Every hiring fact was one posting. The postings
 * were already in hand; counting them was the missing line.
 *
 * Two things here are easy to get wrong and expensive when you do. A count
 * whose text carries no theme word is invisible to twelve of the thirteen
 * hiring definitions, which match on words. And an "increasing count" read off
 * the wrong number in the object turns a shrinking security team into an
 * acceleration signal — which is what the old first-number-in-the-object rule
 * did, because Postgres does not preserve jsonb key order.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const m = await loadHermetic("./scripts/hiring-count-test-entry.ts", "/tmp/jyra-hiring-count.cjs");

const posting = (title) => ({
  sourceUrl: `https://boards.example.com/${encodeURIComponent(title)}`,
  sourceDomain: "boards.example.com", sourceType: "job_posting",
  title, effectiveDate: "2026-09-01", factType: "JOB_OPENING",
  structuredValue: { title, location: null, url: "u", companyName: "Datadog" },
  supportingExcerpt: title,
});
const at = new Date("2026-09-15T10:00:00Z");
const count = (titles) => m.countHiringByTheme(titles.map(posting), { companyName: "Datadog", now: at });
const find = (rows, theme) => rows.find((row) => row.theme === theme);

// 1. Themes are counted, and the total is always emitted — the one definition
//    that matches on nothing (RECRUITMENT_HIRING_SURGE) has nothing else.
{
  const rows = count([
    "Senior Security Engineer", "Security Operations Analyst", "SOC Analyst",
    "Field Marketing Manager", "Backend Engineer",
  ]);
  assert.equal(find(rows, "security").count, 3);
  assert.equal(find(rows, "marketing").count, 1);
  assert.equal(find(rows, "all").count, 5);
  assert.equal(find(rows, "all").total, 5);
  assert.equal(find(rows, "finance"), undefined,
    "a theme with no postings is not emitted — zero would decay into a signal the moment one appeared");
  assert.equal(m.countHiringByTheme([], { companyName: "Datadog", now: at }).length, 0);
}

// 2. The text carries the theme word. Twelve of the thirteen hiring
//    definitions match on words against the fact's own text, so a count that
//    reads "31 open positions" is invisible to all of them.
{
  const rows = count(["Senior Security Engineer", "SOC Analyst", "Backend Engineer"]);
  const security = find(rows, "security");
  assert.match(security.supportingExcerpt, /security/i);
  assert.equal(security.supportingExcerpt, "Datadog has 2 open security roles of 3 open positions.");
  assert.equal(find(rows, "all").supportingExcerpt, "Datadog has 3 open positions.");
  assert.equal(count(["Security Engineer"])[0].supportingExcerpt, "Datadog has 1 open security role of 1 open position.",
    "singular reads as English, because a human sees this sentence on the company page");
}

// 3. The effective date is the day it was observed, not the posting's date.
//    A count is a statement about now; the postings it counted are older.
{
  assert.equal(find(count(["Security Engineer"]), "all").effectiveDate, "2026-09-15");
}

// 4. The acceleration rule reads the count, not whatever number sorts first.
{
  const definition = {
    id: "d1", code: "SECURITY_HIRING_ACCELERATION", version: 1, status: "APPROVED",
    minimumConfidence: 60, defaultStrength: 88, lifetimeDays: 60, decayRule: "LINEAR",
    configuration: { mode: "increasing_count", minFacts: 2, factTypes: ["HIRING_COUNT"], matchAny: ["security", "cyber"] },
    factRequirements: { minFacts: 2, factTypes: ["HIRING_COUNT"] },
  };
  const fact = (id, date, count, total) => ({
    id, evidenceId: `e-${id}`, factType: "HIRING_COUNT", effectiveDate: date, confidence: 80,
    supportingExcerpt: `Datadog has ${count} open security roles of ${total} open positions.`,
    // total is deliberately larger and deliberately shrinking, so a rule that
    // reads the wrong field gets the opposite answer.
    structuredValue: { count, theme: "security", total, companyName: "Datadog" },
  });

  const rising = m.detectSignalCandidates([fact("a", "2026-09-01", 8, 400), fact("b", "2026-09-15", 12, 300)], [definition]);
  assert.equal(rising.length, 1, "eight security roles becoming twelve is an acceleration");
  assert.equal(rising[0].confidence, 80);

  const falling = m.detectSignalCandidates([fact("a", "2026-09-01", 12, 300), fact("b", "2026-09-15", 8, 400)], [definition]);
  assert.equal(falling.length, 0, "a shrinking security team is not an acceleration, whatever the board total did");

  const flat = m.detectSignalCandidates([fact("a", "2026-09-01", 8, 300), fact("b", "2026-09-15", 8, 300)], [definition]);
  assert.equal(flat.length, 0, "standing still is not news");

  const alone = m.detectSignalCandidates([fact("a", "2026-09-01", 8, 300)], [definition]);
  assert.equal(alone.length, 0, "one observation is a count, not a trend");
}

// 5. Facts written before there was a count field still work.
{
  const legacy = {
    id: "old", evidenceId: "e", factType: "HIRING_COUNT", effectiveDate: "2026-08-01", confidence: 80,
    supportingExcerpt: "Datadog security hiring", structuredValue: { openRoles: 4 },
  };
  const fresh = { ...legacy, id: "new", evidenceId: "e2", effectiveDate: "2026-09-01", structuredValue: { count: 9, total: 2 } };
  const definition = {
    id: "d1", code: "X", version: 1, status: "APPROVED", minimumConfidence: 60, defaultStrength: 88,
    lifetimeDays: 60, decayRule: "LINEAR",
    configuration: { mode: "increasing_count", minFacts: 2, factTypes: ["HIRING_COUNT"], matchAny: ["security"] },
    factRequirements: {},
  };
  assert.equal(m.detectSignalCandidates([legacy, fresh], [definition]).length, 1,
    "four to nine is still an increase when the older fact predates the count field");
}

// 6. Theme patterns are word-bounded. "SOC" must not match "social media
//    manager", or every marketing hire becomes a security signal.
{
  const rows = count(["Social Media Manager", "Associate Product Manager", "Data Scientist"]);
  assert.equal(find(rows, "security"), undefined, "'Social' is not SOC and 'Associate' is not security");
  assert.equal(find(rows, "data").count, 1);
}

console.log("hiring count: ok");
