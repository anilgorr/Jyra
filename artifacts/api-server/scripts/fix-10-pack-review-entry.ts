import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { and, desc, eq } from "drizzle-orm";
import { db, intelligencePackVersionsTable, intelligencePacksTable, organizationMembersTable } from "@workspace/db";
import { activateOpportunityPackVersion, approveOpportunityPackVersion, cloneOpportunityPackVersion, getOpportunityPackDetail, setOpportunityClusterReview, setOpportunityQuestionReview, setOpportunitySignalReview } from "../src/lib/opportunity-packs";
import { resolveProjectSellerContext } from "../src/lib/seller-context";

const projectId = "b4c8a95a-eb1c-4a86-89d6-62d72097d820";
const organizationId = "02d40c31-72e4-42d9-9d8d-fe676a369205";
const reportPath = "JYRA_FIX_10_OPPORTUNITY_PACK_REVIEW.json";
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function clusterStructuralFinding(cluster: { id: string; requiredSignalCodes: string[]; negativeSignalCodes: string[] }) {
  const overlap = cluster.requiredSignalCodes.filter((code) => cluster.negativeSignalCodes.includes(code));
  return overlap.length ? { clusterId: cluster.id, invalid: true, overlap } : { clusterId: cluster.id, invalid: false, overlap: [] };
}
export function validateDisabledClusterIds(ids: string[], proposalClusterIds: string[], invalidIds: string[]) {
  if (ids.some((id) => !proposalClusterIds.includes(id))) throw new Error("Disabled cluster ID does not belong to the exact inspected proposal");
  if (invalidIds.some((id) => !ids.includes(id))) throw new Error("Every structurally invalid cluster must be explicitly disabled");
}
async function proposal() {
  const context = await resolveProjectSellerContext(projectId, organizationId);
  const rows = await db.select({ pack: intelligencePacksTable, version: intelligencePackVersionsTable }).from(intelligencePacksTable)
    .innerJoin(intelligencePackVersionsTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id))
    .where(and(eq(intelligencePacksTable.projectId, projectId), eq(intelligencePackVersionsTable.status, "PROPOSED")))
    .orderBy(desc(intelligencePackVersionsTable.version));
  const generic = new Set(["offering", "service", "services", "solution", "product"]);
  const expectedName = context.context.offeringName?.trim();
  const expectedDescription = context.context.offeringDescription?.trim();
  const row = rows.find(({ pack, version }) => {
    const snapshot = (version.offeringSnapshot ?? {}) as Record<string, unknown>;
    const name = typeof (snapshot.name ?? snapshot.offeringName) === "string" ? String(snapshot.name ?? snapshot.offeringName).trim() : "";
    const description = typeof (snapshot.description ?? snapshot.offeringDescription) === "string" ? String(snapshot.description ?? snapshot.offeringDescription).trim() : "";
    return version.generationMethod === "AI_PROPOSAL"
      && version.sourceBusinessTwinVersionId === context.businessTwinVersionId
      && version.sourceIcpVersionId === context.icpVersionId
      && !generic.has(pack.offeringKey.toLowerCase())
      && Boolean(expectedName && expectedDescription && name === expectedName && description === expectedDescription);
  });
  if (!row) throw new Error("No proposed Opportunity Pack exists for the valid Managed SOC project");
  return row;
}
export async function inspectFix10Pack() {
  const context = await resolveProjectSellerContext(projectId, organizationId);
  const row = await proposal();
  if (row.version.sourceBusinessTwinVersionId !== context.businessTwinVersionId || row.version.sourceIcpVersionId !== context.icpVersionId) throw new Error("Proposed pack source context is stale or mismatched");
  const detail = await getOpportunityPackDetail(projectId, row.pack.id, row.version.id);
  const reviewFindings = detail?.clusters.map(clusterStructuralFinding) ?? [];
  const report = { proposalFingerprint: fingerprint({ packId: row.pack.id, version: row.version }), context, pack: detail, reviewFindings };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  return report;
}
export async function activateReviewedFix10Pack() {
  const inspected = await inspectFix10Pack();
  if (!existsSync(reportPath) || JSON.parse(readFileSync(reportPath, "utf8")).proposalFingerprint !== inspected.proposalFingerprint) throw new Error("Exact proposal review report is required");
  const [member] = await db.select({ userId: organizationMembersTable.userId }).from(organizationMembersTable).where(eq(organizationMembersTable.organizationId, organizationId)).limit(1);
  if (!member) throw new Error("No legitimate organization member is available for review");
  const original = (inspected.pack as NonNullable<Awaited<ReturnType<typeof getOpportunityPackDetail>>>)!;
  const [existing] = await db.select().from(intelligencePackVersionsTable).where(and(
    eq(intelligencePackVersionsTable.intelligencePackId, original.pack.id),
    eq(intelligencePackVersionsTable.status, "ACTIVATED"),
    eq(intelligencePackVersionsTable.sourceBusinessTwinVersionId, inspected.context.businessTwinVersionId!),
    eq(intelligencePackVersionsTable.sourceIcpVersionId, inspected.context.icpVersionId!),
  )).limit(1);
  if (existing) return existing;
  const disabledIds = (process.env.JYRA_FIX_10_DISABLED_CLUSTER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const findings = (inspected.reviewFindings as Array<{ clusterId: string; invalid: boolean }>);
  validateDisabledClusterIds(disabledIds, original.clusters.map((cluster) => cluster.id), findings.filter((item) => item.invalid).map((item) => item.clusterId));
  const auth = { projectId, organizationId, userId: member.userId };
  const revision = await cloneOpportunityPackVersion({ ...auth, versionId: original.version!.id });
  const detail = await getOpportunityPackDetail(projectId, original.pack.id, revision.id);
  if (!detail?.version || detail.version.sourceBusinessTwinVersionId !== inspected.context.businessTwinVersionId || detail.version.sourceIcpVersionId !== inspected.context.icpVersionId) throw new Error("Customer revision source context mismatch");
  for (const signal of detail.signals) await setOpportunitySignalReview({ ...auth, signalId: signal.id, reviewStatus: "APPROVED" });
  for (const question of detail.questions) await setOpportunityQuestionReview({ ...auth, questionId: question.id, reviewStatus: "APPROVED" });
  for (const cluster of detail.clusters) {
    // Cloning changes IDs; map source reviewer disposition by stable full
    // cluster content rather than allowing a foreign/revision ID through env.
    const source = original.clusters.find((item) => fingerprint({
      name: item.name, description: item.description, required: item.requiredSignalCodes,
      optional: item.optionalSignalCodes, negative: item.negativeSignalCodes,
    }) === fingerprint({
      name: cluster.name, description: cluster.description, required: cluster.requiredSignalCodes,
      optional: cluster.optionalSignalCodes, negative: cluster.negativeSignalCodes,
    }));
    if (!source) throw new Error("Could not map a cloned cluster to the inspected proposal");
    await setOpportunityClusterReview({ ...auth, clusterId: cluster.id, reviewStatus: disabledIds.includes(source.id) ? "DISABLED" : "APPROVED" });
  }
  await approveOpportunityPackVersion({ ...auth, versionId: revision.id });
  return activateOpportunityPackVersion({ ...auth, versionId: revision.id });
}