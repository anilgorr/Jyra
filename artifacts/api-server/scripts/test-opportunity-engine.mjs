import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Opportunity engine tests");

const output = "/tmp/jyra-opportunity-engine-test.cjs";
await build({ entryPoints: ["./scripts/opportunity-test-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const h = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const evidence = (overrides = {}) => ({
  id: "evidence-1", sourceDomain: "example.com", authority: 90, directness: 90,
  freshness: 90, corroboration: 90, status: "VERIFIED", ...overrides,
});
const signal = (overrides = {}) => ({
  id: "signal-1", polarity: "POSITIVE", strength: 90, confidence: 90,
  needImpact: 90, timingImpact: 90, fitImpact: 0, status: "ACTIVE",
  factIds: ["fact-1"], evidenceIds: ["evidence-1"], ...overrides,
});
const cluster = (overrides = {}) => ({
  id: "cluster-1", strength: 90, confidence: 90, needImpact: 95, timingImpact: 95,
  status: "ACTIVE", signalIds: ["signal-1"], evidenceIds: ["evidence-1"], ...overrides,
});
const fit = (result = "pass") => [{ id: "criterion-1", type: "MUST_HAVE", weight: null, result }];
const base = (overrides = {}) => ({
  weights: h.DEFAULT_OPPORTUNITY_WEIGHTS,
  fitResults: fit(),
  signals: [signal()],
  clusters: [],
  evidence: [evidence(), evidence({ id: "evidence-2", sourceDomain: "second.example" }), evidence({ id: "evidence-3", sourceDomain: "third.example" })],
  relationshipStatus: "NONE",
  previous: null,
  ...overrides,
});

const highFitNoNeed = h.calculateOpportunityAssessment(base({ signals: [], clusters: [] }));
assert.equal(highFitNoNeed.state, "WATCH", "high Fit without Need must be gated");
assert.equal(highFitNoNeed.components.find((item) => item.dimension === "NEED").score, null);

const highNeedLowFit = h.calculateOpportunityAssessment(base({ fitResults: fit("fail") }));
assert.equal(highNeedLowFit.state, "WATCH", "strong Need with poor Fit must be gated");

const weakConfidence = h.calculateOpportunityAssessment(base({ evidence: [evidence({ authority: 10, directness: 10, freshness: 10, corroboration: 10, status: "CONFLICTING" })] }));
assert.equal(weakConfidence.assessmentStatus, "NEEDS_MORE_RESEARCH");
assert.notEqual(weakConfidence.state, "SURGING");

const strongCluster = h.calculateOpportunityAssessment(base({ clusters: [cluster()], relationshipStatus: "KNOWN_CHAMPION" }));
assert.equal(strongCluster.state, "SURGING");
assert.equal(strongCluster.components.find((item) => item.dimension === "NEED").clusterIds.length, 1);

const negative = h.calculateOpportunityAssessment(base({ signals: [signal({ polarity: "NEGATIVE" })] }));
assert.equal(negative.state, "WATCH");

const stale = h.calculateOpportunityAssessment(base({ signals: [signal({ status: "STALE" })] }));
assert.equal(stale.components.find((item) => item.dimension === "NEED").score, null);

const contradictory = h.calculateOpportunityAssessment(base({ evidence: [evidence(), evidence({ id: "evidence-2", sourceDomain: "second.example", status: "CONFLICTING" })] }));
assert.equal(contradictory.components.find((item) => item.dimension === "CONFIDENCE").details.contradictions, 1);

const missing = h.calculateOpportunityAssessment(base({ fitResults: [{ id: "criterion-1", type: "MUST_HAVE", weight: null, result: "unknown" }] }));
assert.equal(missing.components.find((item) => item.dimension === "FIT").score, null, "unknown ICP information must not become failure");
assert.equal(missing.score, null, "an unknown core dimension must keep the overall score unknown");
assert.equal(missing.assessmentStatus, "INSUFFICIENT_DATA");
assert.notEqual(missing.state, "DORMANT", "insufficient evidence must not become DORMANT");

const entirelyUnknown = h.calculateOpportunityAssessment(base({ fitResults: fit("unknown"), signals: [], clusters: [], evidence: [], relationshipStatus: "NONE" }));
assert.equal(entirelyUnknown.score, null, "unknown dimensions must not silently become numeric zero");
assert.ok(entirelyUnknown.components.filter((item) => item.dimension !== "CONFIDENCE").every((item) => item.score === null));
assert.notEqual(entirelyUnknown.state, "DORMANT");

const evaluatedWeak = h.calculateOpportunityAssessment(base({
  signals: [signal({ polarity: "NEGATIVE", needImpact: 0, timingImpact: 0 })],
  relationshipStatus: "PREVIOUS_CONTACT",
}));
assert.equal(evaluatedWeak.score, 32.5, "evaluated zero impacts remain real numeric zeroes");
assert.equal(evaluatedWeak.state, "WATCH");

const evaluatedDormant = h.calculateOpportunityAssessment(base({
  fitResults: [{ id: "criterion-1", type: "DISQUALIFIER", weight: null, result: "pass" }],
  signals: [signal({ polarity: "NEGATIVE", needImpact: 0, timingImpact: 0 })],
  relationshipStatus: "NONE",
}));
assert.equal(evaluatedDormant.score, 0);
assert.equal(evaluatedDormant.state, "DORMANT", "sufficiently evaluated weak inputs may still be DORMANT");

const relationship = h.calculateOpportunityAssessment(base({ relationshipStatus: "OPEN_OPPORTUNITY" }));
assert.equal(relationship.state, "ACTIVE");
assert.equal(relationship.components.find((item) => item.dimension === "RELATIONSHIP").score, 80);

const sellerA = h.calculateOpportunityAssessment(base());
const sellerB = h.calculateOpportunityAssessment(base({ fitResults: fit("fail") }));
assert.notEqual(sellerA.state, sellerB.state, "the same company may be interpreted differently by different projects");

const cooling = h.calculateOpportunityAssessment(base({
  signals: [signal({ strength: 25, needImpact: 40, timingImpact: 20 })],
  previous: { state: "SURGING", score: 92, timingScore: 90 },
}));
assert.equal(cooling.state, "COOLING");

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `opportunity-test-${suffix}`;
let organization;
try {
  await h.db.insert(h.usersTable).values({ id: userId });
  [organization] = await h.db.insert(h.organizationsTable).values({ name: `Opportunity ${suffix}`, createdByUserId: userId }).returning();
  const [project] = await h.db.insert(h.projectsTable).values({ organizationId: organization.id, name: "Opportunity project" }).returning();
  const [company] = await h.db.insert(h.companiesTable).values({ canonicalName: `Opportunity Co ${suffix}`, domain: `opportunity-${suffix}.example` }).returning();
  const [projectCompany] = await h.db.insert(h.projectCompaniesTable).values({ projectId: project.id, companyId: company.id, relationshipStatus: "NONE" }).returning();
  const persisted = await h.evaluateOpportunity({ organizationId: organization.id, projectId: project.id, projectCompanyId: projectCompany.id, userId });
  assert.equal(persisted.opportunity.state, "WATCH");
  assert.equal(persisted.opportunity.score, null);
  assert.equal(persisted.opportunity.assessmentStatus, "INSUFFICIENT_DATA");
  const histories = await h.db.select().from(h.opportunityHistoryTable).where(h.eq(h.opportunityHistoryTable.opportunityId, persisted.opportunity.id));
  assert.equal(histories.length, 1);
  const components = await h.db.select().from(h.opportunityScoreComponentsTable).where(h.eq(h.opportunityScoreComponentsTable.historyId, histories[0].id));
  assert.equal(components.length, 5);
  const concurrentWhy = await Promise.all([
    h.generateWhyForOpportunity(persisted.opportunity.id, project.id),
    h.generateWhyForOpportunity(persisted.opportunity.id, project.id),
  ]);
  assert.deepEqual(concurrentWhy.map((result) => result.explanation.version).sort(), [1, 2], "concurrent WHY refreshes must receive sequential versions");
  const whyVersions = await h.db.select().from(h.whyExplanationsTable)
    .where(h.eq(h.whyExplanationsTable.opportunityId, persisted.opportunity.id))
    .orderBy(h.asc(h.whyExplanationsTable.version));
  assert.equal(whyVersions.length, 2);
  assert.equal(whyVersions.filter((item) => item.current).length, 1, "exactly one WHY version must remain current");
  assert.equal(whyVersions[0].text, "Insufficient evidence to establish current urgency.");
  await assert.rejects(
    () => h.db.update(h.whyExplanationsTable).set({ text: "Rewritten history" }).where(h.eq(h.whyExplanationsTable.id, whyVersions[0].id)),
    (error) => /immutable/.test(String(error?.cause?.message ?? error?.message)),
    "historical WHY content must not be editable",
  );
  const whyClaims = await h.db.select().from(h.whyClaimsTable).where(h.eq(h.whyClaimsTable.explanationId, whyVersions[0].id));
  await assert.rejects(
    () => h.db.update(h.whyClaimsTable).set({ claimText: "Rewritten claim" }).where(h.and(
      h.eq(h.whyClaimsTable.explanationId, whyVersions[0].id), h.eq(h.whyClaimsTable.ordinal, whyClaims[0].ordinal),
    )),
    (error) => /immutable/.test(String(error?.cause?.message ?? error?.message)),
    "WHY claim provenance must not be editable",
  );
} finally {
  if (organization) await h.db.delete(h.organizationsTable).where(h.eq(h.organizationsTable.id, organization.id));
  await h.db.delete(h.usersTable).where(h.eq(h.usersTable.id, userId));
}

console.log("Opportunity scoring, gating, uncertainty, relationship, cooling, genericity, and history tests passed.");