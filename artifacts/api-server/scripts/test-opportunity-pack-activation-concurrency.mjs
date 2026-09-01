import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-opportunity-pack-activation-concurrency-test.cjs";
await build({
  entryPoints: ["./scripts/signal-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});
const h = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `activation-concurrency-${suffix}`;
let organization;
let signalPackId;

try {
  await h.db.insert(h.usersTable).values({ id: userId });
  [organization] = await h.db.insert(h.organizationsTable)
    .values({ name: `Activation Concurrency ${suffix}`, createdByUserId: userId })
    .returning();
  const [project] = await h.db.insert(h.projectsTable)
    .values({ organizationId: organization.id, name: "Concurrency Test" })
    .returning();
  const [pack] = await h.db.insert(h.intelligencePacksTable).values({
    organizationId: organization.id,
    projectId: project.id,
    offeringKey: `concurrency-${suffix}`,
    status: "APPROVED",
    currentVersion: 1,
    createdBy: userId,
  }).returning();
  const [version] = await h.db.insert(h.intelligencePackVersionsTable).values({
    intelligencePackId: pack.id,
    version: 1,
    status: "APPROVED",
    offeringSnapshot: { name: "Concurrency Test Offering" },
    businessContextSnapshot: { fixture: true },
    generationMethod: "CUSTOMER_REVISION",
    createdBy: userId,
    approvedBy: userId,
    approvedAt: new Date(),
  }).returning();
  const [signal] = await h.db.insert(h.intelligencePackSignalsTable).values({
    versionId: version.id,
    code: `CONCURRENT_${suffix.replace(/[^a-z0-9]/gi, "_").toUpperCase()}`.slice(0, 63),
    name: "Concurrent activation signal",
    description: "Ensures one downstream definition is created.",
    whyItMatters: "Activation must be idempotent under concurrency.",
    category: "TEST",
    polarity: "POSITIVE",
    needImpact: 50,
    timingImpact: 50,
    fitImpact: 50,
    likelyEvidence: ["Public source"],
    sourceCapabilities: ["WEB_SEARCH"],
    lifetimeDays: 90,
    suggestedStrength: 60,
    minimumConfidence: 70,
    potentialFalsePositives: [],
    factTypes: ["LEADERSHIP_CHANGE"],
    matchingConfiguration: { factTypes: ["LEADERSHIP_CHANGE"] },
    reviewStatus: "APPROVED",
  }).returning();
  await h.db.insert(h.intelligencePackClustersTable).values({
    versionId: version.id,
    name: "Concurrent activation cluster",
    description: "Ensures one downstream cluster definition is created.",
    requiredSignalCodes: [signal.code],
    minimumIndependentSignals: 1,
    reviewStatus: "APPROVED",
  });

  const [activationA, activationB] = await Promise.all([
    h.activateOpportunityPackVersion(version.id, userId),
    h.activateOpportunityPackVersion(version.id, userId),
  ]);

  assert.equal(activationA.version?.status ?? activationA.status, "ACTIVATED");
  assert.equal(activationB.version?.status ?? activationB.status, "ACTIVATED");
  signalPackId = activationA.signalPack?.id ?? activationB.signalPack?.id;
  assert.ok(signalPackId);

  const definitions = await h.db.select().from(h.signalDefinitionsTable)
    .where(h.eq(h.signalDefinitionsTable.signalPackId, signalPackId));
  assert.equal(definitions.length, 1);

  const clusterDefinitions = await h.db.select().from(h.signalClusterDefinitionsTable)
    .where(h.eq(h.signalClusterDefinitionsTable.intelligencePackId, pack.id));
  assert.equal(clusterDefinitions.length, 1);

  const selections = await h.db.select().from(h.projectSignalPacksTable)
    .where(h.eq(h.projectSignalPacksTable.signalPackId, signalPackId));
  assert.equal(selections.length, 1);
  assert.equal(selections[0].active, true);

  console.log("Concurrent Opportunity Intelligence Pack activation test passed.");
} finally {
  if (organization) {
    await h.db.delete(h.organizationsTable).where(h.eq(h.organizationsTable.id, organization.id));
  }
  if (signalPackId) {
    await h.db.delete(h.signalDefinitionsTable).where(h.eq(h.signalDefinitionsTable.signalPackId, signalPackId));
    await h.db.delete(h.signalPacksTable).where(h.eq(h.signalPacksTable.id, signalPackId));
  }
  await h.db.delete(h.usersTable).where(h.eq(h.usersTable.id, userId));
}