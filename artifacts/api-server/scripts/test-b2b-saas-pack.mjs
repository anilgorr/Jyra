/**
 * The launch vertical had no signal pack, so need and timing were null for all
 * 119 companies and every score was fit/3 — a sixteen-way tie at the top with
 * LIKELY_NOT_FIT companies in it. This pack is what turns the facts into an
 * order, and these assertions are the seller's two explicit calls.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const f = await loadHermetic("./scripts/b2b-saas-pack-test-entry.ts", "/tmp/jyra-b2b-saas-pack.cjs");

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log(`  ok  ${name}`); };

const pack = f.SIGNAL_PACK_FIXTURES.find((p) => p.slug === "b2b-saas-revenue-tools");
const by = (code) => pack.definitions.find((d) => d.code === code);

check("the pack exists and every definition is well formed", () => {
  assert.ok(pack, "a seller of sales tooling needs a pack of its own");
  for (const d of pack.definitions) {
    assert.ok(d.code && d.name && d.description, `${d.code} is described`);
    assert.ok(d.factTypes.length, `${d.code} binds to at least one fact type`);
    assert.ok(d.defaultStrength > 0 && d.defaultStrength <= 100);
    const negative = d.polarity === "NEGATIVE";
    for (const impact of [d.needImpact, d.timingImpact, d.fitImpact]) {
      assert.equal(impact < 0, negative, `${d.code} impacts must agree with its polarity`);
      assert.ok(Math.abs(impact) <= 100);
    }
  }
  // Every fact type this pool actually produces has somewhere to land.
  const bound = new Set(pack.definitions.flatMap((d) => d.factTypes));
  for (const type of ["FUNDING_EVENT", "LEADERSHIP_CHANGE", "JOB_OPENING", "HIRING_COUNT", "WORKFORCE_REDUCTION", "ACQUIRED"]) {
    assert.ok(bound.has(type), `${type} is produced by the pipeline and must be interpreted`);
  }
});

check("funding outranks hiring, because funding is a decision to grow and a req can be a backfill", () => {
  const funding = by("SAAS_FUNDING_ROUND");
  for (const code of ["SAAS_SDR_HIRING", "SAAS_SALES_HIRING_ACCELERATION", "SAAS_REVENUE_TEAM_HIRING"]) {
    const hiring = by(code);
    assert.ok(funding.needImpact > hiring.needImpact, `funding need must exceed ${code}`);
    assert.ok(funding.timingImpact > hiring.timingImpact, `funding timing must exceed ${code}`);
  }
  // And a generic opening ranks below a specifically outbound one.
  assert.ok(by("SAAS_SDR_HIRING").needImpact > by("SAAS_REVENUE_TEAM_HIRING").needImpact,
    "an SDR req says more than an AE req to a seller of outbound tooling");
  // A revenue leader is the other top signal; a CTO change is not.
  assert.ok(by("SAAS_NEW_REVENUE_LEADER").needImpact > by("SAAS_GTM_LEADERSHIP_CHANGE").needImpact + 20,
    "a new CRO is a different event from a new CTO");
});

check("a layoff discounts rather than disqualifies", () => {
  // Same code as every other pack — the code is the shared meaning, the
  // numbers are what a pack is for.
  const ours = by("WORKFORCE_REDUCTION");
  assert.equal(ours.polarity, "NEGATIVE");
  // The shared rule in every other pack is -80/-85. That suppresses. For this
  // seller cost pressure also drives consolidation onto one platform, so the
  // discount has to be materially gentler than the suppression.
  assert.ok(Math.abs(ours.needImpact) < 40, `need discount is a discount, not a veto (${ours.needImpact})`);
  assert.ok(Math.abs(ours.timingImpact) < 45, `timing discount is a discount, not a veto (${ours.timingImpact})`);
  // A layoff must not outweigh a funding round on the same company.
  assert.ok(by("SAAS_FUNDING_ROUND").needImpact > Math.abs(ours.needImpact) * 2,
    "a funded company that also trimmed staff still ranks");
  // But being acquired does stop the purchase: the budget moves to a new owner.
  const acquired = by("ACQUIRED");
  assert.ok(Math.abs(acquired.timingImpact) > Math.abs(ours.timingImpact) * 2,
    "acquisition suppresses where a layoff only discounts");
});

check("the five existing packs keep the strict shared layoff rule", () => {
  assert.equal(by("WORKFORCE_REDUCTION").needImpact, -28, "this pack's own reading");
  for (const other of f.SIGNAL_PACK_FIXTURES.filter((p) => p.slug !== "b2b-saas-revenue-tools")) {
    const layoff = other.definitions.find((d) => d.code === "WORKFORCE_REDUCTION");
    assert.ok(layoff, `${other.slug} still carries the shared layoff definition`);
    assert.equal(layoff.needImpact, -80, `${other.slug} is unchanged`);
    assert.equal(layoff.timingImpact, -85, `${other.slug} is unchanged`);
  }
  // And this pack does not carry both, which would double-count a layoff.
  assert.equal(pack.definitions.filter((d) => d.factTypes.includes("WORKFORCE_REDUCTION")).length, 1);
});

check("confidence floors match what the evidence arithmetic actually produces", () => {
  // Measured on the launch pool. A single third-party report lands near 55
  // however fresh — Temporal's $550M at three days old scored 55.8, Clay 55.1,
  // Zendesk's CMO 56.3 — and only multi-source corroboration passes 60, which
  // Whatfix reached at 66.8 on six outlets. The inherited floor of 60 fired
  // nothing at all from 27 funding facts and 9 layoffs.
  for (const code of ["SAAS_FUNDING_ROUND", "SAAS_NEW_REVENUE_LEADER", "SAAS_GTM_LEADERSHIP_CHANGE"]) {
    const d = by(code);
    assert.ok(d.minimumConfidence <= 50, `${code} must admit one fresh credible report (${d.minimumConfidence})`);
    assert.ok(d.minimumConfidence >= 45, `${code} must still exclude a four-month-old round decayed into the low 40s`);
  }

  // A negative that only discounts inverts the usual caution. Withholding it
  // over-ranks a company that is visibly cutting staff, so its floor is the
  // lowest in the pack — and the shared 80 admitted none of the 9 layoff facts,
  // which top out at 43.
  const layoff = by("WORKFORCE_REDUCTION");
  assert.ok(layoff.minimumConfidence < 45, `a discount must actually apply (${layoff.minimumConfidence})`);
  assert.ok(layoff.minimumConfidence < by("SAAS_FUNDING_ROUND").minimumConfidence,
    "an adjustment needs less proof than a claim");

  // Hiring comes off ATS boards and scores 85 to 91, so it keeps the default.
  for (const code of ["SAAS_SDR_HIRING", "SAAS_REVENUE_TEAM_HIRING", "SAAS_SALES_HIRING_ACCELERATION"]) {
    assert.equal(by(code).minimumConfidence, 60, `${code} reads first-party ATS data and needs no relief`);
  }
});

console.log(`\nb2b saas pack: ${checks} checks passed`);
