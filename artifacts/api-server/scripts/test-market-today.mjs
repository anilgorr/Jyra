import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-market-today-test.cjs";
await build({ entryPoints: ["./scripts/market-today-test-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const h = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

assert.equal(h.scoreBand(80), "HIGH");
assert.equal(h.scoreBand(55), "MEDIUM");
assert.equal(h.scoreBand(20), "LOW");
assert.equal(h.scoreBand(null), "UNKNOWN");

const complete = {
  assessmentStatus: "COMPLETE",
  timingScore: 80,
  confidenceScore: 75,
  whyStatus: "SUFFICIENT_EVIDENCE",
  timingDelta: 5,
};
assert.equal(h.deriveWhen({ ...complete, state: "SURGING" }), "NOW");
assert.equal(h.deriveWhen({ ...complete, state: "RISING", timingScore: 55 }), "EARLY_WINDOW");
assert.equal(h.deriveWhen({ ...complete, state: "WATCH", timingScore: 35 }), "MONITOR");
assert.equal(h.deriveWhen({ ...complete, state: "COOLING" }), "TIMING_WEAKENING");
assert.equal(h.deriveWhen({ ...complete, state: "RISING", timingDelta: -25 }), "TIMING_WEAKENING");
assert.equal(h.deriveWhen({ ...complete, state: "SURGING", whyStatus: "INSUFFICIENT_EVIDENCE" }), "INSUFFICIENT_EVIDENCE");
assert.equal(h.deriveWhen({ ...complete, state: "SURGING", assessmentStatus: "NEEDS_MORE_RESEARCH" }), "INSUFFICIENT_EVIDENCE");

const now = new Date("2026-08-29T10:00:00.000Z");
assert.equal(h.deriveResearchFreshness(null, [], now), "NOT_RESEARCHED");
assert.equal(h.deriveResearchFreshness(new Date("2026-08-15T10:00:00.000Z"), [{ freshnessScore: 90, status: "VERIFIED" }], now), "FRESH");
assert.equal(h.deriveResearchFreshness(new Date("2026-07-01T10:00:00.000Z"), [{ freshnessScore: 55, status: "VERIFIED" }], now), "AGING");
assert.equal(h.deriveResearchFreshness(new Date("2026-01-01T10:00:00.000Z"), [{ freshnessScore: 90, status: "VERIFIED" }], now), "STALE");
assert.equal(h.deriveResearchFreshness(new Date("2026-08-28T10:00:00.000Z"), [{ freshnessScore: 90, status: "STALE" }], now), "STALE");

const projectCompany = {
  id: "project-company-1", projectId: "project-1", companyId: "company-1", status: "active",
  researchStatus: "complete", fitScore: 80, needScore: 70, timingScore: 80, relationshipScore: 0,
  confidenceScore: 75, opportunityState: "active", relationshipStatus: "NONE", opportunityScore: 78,
  opportunityAssessmentState: "SURGING", latestResearchAt: new Date("2026-08-20T10:00:00.000Z"),
  createdAt: now, updatedAt: now,
};
const company = {
  id: "company-1", canonicalName: "Seller-agnostic Example", domain: "example.test", website: null,
  linkedinUrl: null, country: "IN", industry: "Software", employeeCount: 500, employeeRange: "201-500",
  description: null, createdAt: now, updatedAt: now,
};
const opportunity = {
  id: "opportunity-1", organizationId: "org-1", projectId: "project-1", projectCompanyId: projectCompany.id,
  companyId: company.id, modelVersionId: "model-1", score: 78, fitScore: 80, needScore: 70, timingScore: 80,
  relationshipScore: 0, confidenceScore: 75, state: "SURGING", assessmentStatus: "COMPLETE",
  explanation: "Persisted score.", inputSnapshot: {}, assessedAt: now, createdAt: now, updatedAt: now,
};
const currentHistory = {
  id: "history-2", opportunityId: opportunity.id, modelVersionId: "model-1", score: 78, state: "SURGING",
  assessmentStatus: "COMPLETE", dimensionSnapshot: { FIT: 80, NEED: 70, TIMING: 80, RELATIONSHIP: 0, CONFIDENCE: 75 },
  explanation: "Current", previousState: "RISING", assessedAt: now, createdAt: now,
};
const previousHistory = {
  ...currentHistory, id: "history-1", score: 64, state: "RISING", previousState: "EMERGING",
  dimensionSnapshot: { FIT: 80, NEED: 60, TIMING: 55, RELATIONSHIP: 0, CONFIDENCE: 70 },
  assessedAt: new Date("2026-08-20T10:00:00.000Z"),
};
const card = h.buildMarketTodayCard({
  projectCompany,
  company,
  opportunity,
  histories: [previousHistory, currentHistory],
  why: { id: "why-1", status: "SUFFICIENT_EVIDENCE", text: "Supported explanation." },
  signals: [],
  clusters: [],
  evidence: [{ freshnessScore: 90, status: "VERIFIED", observedAt: now, extractedClaim: "Current source." }],
  questions: [],
  now,
});
assert.equal(card.section, "SURGING");
assert.equal(card.when, "NOW");
assert.equal(card.movement.label, "RISING → SURGING");
assert.match(card.movement.summary, /Timing rose by 25/);
assert.equal(card.flags.changedToday, true);
assert.equal(card.who, company.canonicalName);

const unsupportedStrongState = h.buildMarketTodayCard({
  projectCompany,
  company,
  opportunity,
  histories: [currentHistory],
  why: { id: "why-2", status: "INSUFFICIENT_EVIDENCE", text: "Insufficient evidence to establish current urgency." },
  signals: [],
  clusters: [],
  evidence: [],
  questions: [],
  now,
});
assert.equal(unsupportedStrongState.section, "NEEDS_RESEARCH", "strong canonical states must not inflate attention when support is insufficient");
assert.equal(unsupportedStrongState.when, "INSUFFICIENT_EVIDENCE");

const insufficient = h.buildMarketTodayCard({
  projectCompany: { ...projectCompany, researchStatus: "not_started", latestResearchAt: null },
  company,
  opportunity: null,
  histories: [],
  why: null,
  signals: [],
  clusters: [],
  evidence: [],
  questions: [],
  now,
});
assert.equal(insufficient.section, "NEEDS_RESEARCH");
assert.equal(insufficient.when, "INSUFFICIENT_EVIDENCE");
assert.equal(insufficient.why.text, "Insufficient evidence to establish current urgency.");
assert.equal(insufficient.flags.needsResearch, true);

console.log("Market Today deterministic classification tests passed");