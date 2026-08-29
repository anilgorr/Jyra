import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

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
  assert.equal(persisted.opportunity.state, "DORMANT");
  assert.equal(persisted.opportunity.assessmentStatus, "NEEDS_MORE_RESEARCH");
  const histories = await h.db.select().from(h.opportunityHistoryTable).where(h.eq(h.opportunityHistoryTable.opportunityId, persisted.opportunity.id));
  assert.equal(histories.length, 1);
  const components = await h.db.select().from(h.opportunityScoreComponentsTable).where(h.eq(h.opportunityScoreComponentsTable.historyId, histories[0].id));
  assert.equal(components.length, 5);
} finally {
  if (organization) await h.db.delete(h.organizationsTable).where(h.eq(h.organizationsTable.id, organization.id));
  await h.db.delete(h.usersTable).where(h.eq(h.usersTable.id, userId));
}

console.log("Opportunity scoring, gating, uncertainty, relationship, cooling, genericity, and history tests passed.");