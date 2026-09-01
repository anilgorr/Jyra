import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  businessTwinVersionsTable,
  db,
  icpVersionsTable,
  intelligencePackVersionsTable,
  intelligencePacksTable,
  projectsTable,
} from "@workspace/db";

const PLACEHOLDERS = new Set(["the seller offering", "seller services", "our solution", "the product"]);
const value = (input: unknown): string | null =>
  typeof input === "string" && input.trim() ? input.trim() : null;
const list = (input: unknown): string[] => Array.isArray(input)
  ? input.filter((item): item is string => Boolean(value(item))).map((item) => item.trim()).slice(0, 20)
  : [];
const first = (...inputs: unknown[]) => inputs.map(value).find(Boolean) ?? null;

export type SellerContext = {
  businessTwinId: string | null;
  businessTwinVersionId: string | null;
  icpId: string | null;
  offeringId: string | null;
  offeringKey: string | null;
  sellerCompanyName: string | null;
  sellerBusinessDescription: string | null;
  sellerBusinessModel: string | null;
  offeringName: string | null;
  offeringCategory: string | null;
  offeringDescription: string | null;
  offeringCapabilities: string[];
  offeringExclusions: string[];
  source: "INTELLIGENCE_PACK" | "BUSINESS_TWIN" | "NONE";
  fingerprint: string;
};

export type SellerContextSufficiency = { sufficient: boolean; reason: "SUFFICIENT" | "MISSING_OFFERING" | "GENERIC_PLACEHOLDER" };
export type ProjectContextMissingRequirement =
  | "PROJECT_NOT_FOUND" | "ORGANIZATION_MISMATCH" | "BUSINESS_TWIN_MISSING"
  | "BUSINESS_TWIN_NOT_USABLE" | "OFFERING_MISSING" | "OFFERING_PLACEHOLDER"
  | "ICP_MISSING" | "ICP_NOT_LINKED_TO_BUSINESS_TWIN" | "OPPORTUNITY_PACK_MISSING";

export type ProjectSellerContext = {
  projectId: string;
  organizationId: string | null;
  businessTwinId: string | null;
  businessTwinVersionId: string | null;
  businessTwinVersion: number | null;
  businessTwinStatus: string | null;
  businessTwinCreatedAt: Date | null;
  businessTwinRawAnswers: unknown;
  businessTwinAiInterpretation: unknown;
  icpId: string | null;
  icpVersionId: string | null;
  icpVersion: number | null;
  icpCreatedAt: Date | null;
  icpAssumptions: unknown;
  opportunityPackId: string | null;
  opportunityPackVersionId: string | null;
  opportunityPackVersion: number | null;
  opportunityPackStatus: string | null;
  opportunityPackCreatedAt: Date | null;
  context: SellerContext;
  sufficiency: SellerContextSufficiency;
  businessTwinReady: boolean;
  offeringReady: boolean;
  icpReady: boolean;
  opportunityPackReady: boolean;
  buyerRoleReady: boolean;
  marketDiscoveryReady: boolean;
  whoReady: boolean;
  whenWhyReady: boolean;
  contextStatus: "READY" | "INSUFFICIENT";
  missingRequirements: ProjectContextMissingRequirement[];
};

export function sellerContextSufficiency(context: Pick<SellerContext, "offeringName" | "offeringDescription" | "offeringCapabilities">): SellerContextSufficiency {
  const offering = context.offeringName?.trim().toLowerCase() ?? "";
  if (!offering) return { sufficient: false, reason: "MISSING_OFFERING" };
  if (PLACEHOLDERS.has(offering)) return { sufficient: false, reason: "GENERIC_PLACEHOLDER" };
  // A proper name alone is meaningful, but a generic product noun is not.
  if (/^(offering|service|services|solution|product)$/i.test(offering)) return { sufficient: false, reason: "GENERIC_PLACEHOLDER" };
  return { sufficient: true, reason: "SUFFICIENT" };
}

/** Pure lifecycle seam shared by DB resolution and fixture tests. */
export function evaluateProjectReadiness(input: {
  projectId: string; organizationId: string | null; expectedOrganizationId?: string;
  twin?: { id: string; businessTwinId: string; version: number; status: string; createdAt: Date; rawAnswers: unknown; aiInterpretation: unknown; manualInterpretation: unknown } | null;
  icp?: { id: string; icpId: string; version: number; createdAt: Date; sourceBusinessTwinVersionId: string | null; assumptions?: unknown } | null;
  pack?: { id: string; offeringKey: string } | null;
  packVersion?: { id: string; version: number; status: string; createdAt: Date; offeringSnapshot: unknown; sourceBusinessTwinVersionId?: string | null; sourceIcpVersionId?: string | null } | null;
}): ProjectSellerContext {
  const packMatchesContext = input.packVersion?.sourceBusinessTwinVersionId === input.twin?.id
    && input.packVersion?.sourceIcpVersionId === input.icp?.id;
  const context = assembleSellerContext({
    ...input,
    pack: packMatchesContext ? input.pack : null,
    packVersion: packMatchesContext ? input.packVersion : null,
  });
  const sufficiency = sellerContextSufficiency(context);
  const tenantOk = Boolean(input.organizationId) && (!input.expectedOrganizationId || input.organizationId === input.expectedOrganizationId);
  const businessTwinReady = tenantOk && input.twin?.status === "ready";
  const offeringReady = businessTwinReady && sufficiency.sufficient;
  const icpReady = offeringReady && Boolean(input.icp) && input.icp?.sourceBusinessTwinVersionId === input.twin?.id;
  const opportunityPackReady = icpReady && packMatchesContext && input.packVersion?.status === "ACTIVATED";
  const missingRequirements: ProjectContextMissingRequirement[] = [];
  if (!input.organizationId) missingRequirements.push("PROJECT_NOT_FOUND");
  else if (!tenantOk) missingRequirements.push("ORGANIZATION_MISMATCH");
  if (!input.twin) missingRequirements.push("BUSINESS_TWIN_MISSING");
  else if (!businessTwinReady) missingRequirements.push("BUSINESS_TWIN_NOT_USABLE");
  if (!sufficiency.sufficient) missingRequirements.push(sufficiency.reason === "GENERIC_PLACEHOLDER" ? "OFFERING_PLACEHOLDER" : "OFFERING_MISSING");
  if (!input.icp) missingRequirements.push("ICP_MISSING");
  else if (input.icp.sourceBusinessTwinVersionId !== input.twin?.id) missingRequirements.push("ICP_NOT_LINKED_TO_BUSINESS_TWIN");
  if (!input.packVersion) missingRequirements.push("OPPORTUNITY_PACK_MISSING");
  return {
    projectId: input.projectId, organizationId: input.organizationId,
    businessTwinId: input.twin?.businessTwinId ?? null, businessTwinVersionId: input.twin?.id ?? null,
    businessTwinVersion: input.twin?.version ?? null, businessTwinStatus: input.twin?.status ?? null, businessTwinCreatedAt: input.twin?.createdAt ?? null,
    businessTwinRawAnswers: input.twin?.rawAnswers ?? {}, businessTwinAiInterpretation: input.twin?.aiInterpretation ?? {},
    icpId: input.icp?.icpId ?? null, icpVersionId: input.icp?.id ?? null, icpVersion: input.icp?.version ?? null, icpCreatedAt: input.icp?.createdAt ?? null,
    icpAssumptions: input.icp?.assumptions ?? [],
    opportunityPackId: input.pack?.id ?? null, opportunityPackVersionId: input.packVersion?.id ?? null,
    opportunityPackVersion: input.packVersion?.version ?? null, opportunityPackStatus: input.packVersion?.status ?? null, opportunityPackCreatedAt: input.packVersion?.createdAt ?? null,
    context, sufficiency, businessTwinReady, offeringReady, icpReady, opportunityPackReady,
    buyerRoleReady: offeringReady, marketDiscoveryReady: icpReady, whoReady: icpReady, whenWhyReady: opportunityPackReady,
    contextStatus: icpReady ? "READY" : "INSUFFICIENT", missingRequirements,
  };
}

function fingerprint(context: Omit<SellerContext, "fingerprint">): string {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}

/** Pure resolver seam. Pack snapshots deliberately win over twin fields only
 * when they are activated/approved by the customer. */
export function assembleSellerContext(input: {
  twin?: { id: string; businessTwinId: string; rawAnswers: unknown; aiInterpretation: unknown; manualInterpretation: unknown } | null;
  icp?: { id: string } | null;
  pack?: { id: string; offeringKey: string } | null;
  packVersion?: { id: string; offeringSnapshot: unknown } | null;
}): SellerContext {
  const raw = (input.twin?.rawAnswers ?? {}) as Record<string, unknown>;
  const interpretation = (input.twin?.manualInterpretation ?? input.twin?.aiInterpretation ?? {}) as Record<string, unknown>;
  const offering = (input.packVersion?.offeringSnapshot ?? {}) as Record<string, unknown>;
  // A pack only overrides authoritative Twin offering fields when it actually
  // contains an offering snapshot; an empty activated snapshot never becomes a
  // synthetic offeringKey-based seller context.
  const usePack = Boolean(input.packVersion && Object.keys(offering).length);
  const context: Omit<SellerContext, "fingerprint"> = {
    businessTwinId: input.twin?.businessTwinId ?? null,
    businessTwinVersionId: input.twin?.id ?? null,
    icpId: input.icp?.id ?? null,
    offeringId: input.pack?.id ?? null,
    offeringKey: input.pack?.offeringKey ?? first(offering.key, offering.offeringKey),
    sellerCompanyName: first(offering.sellerCompanyName, offering.companyName, raw.companyName, raw.businessName, interpretation.company_name),
    sellerBusinessDescription: first(offering.sellerBusinessDescription, offering.businessDescription, raw.businessDescription, raw.companyDescription, interpretation.business_description),
    sellerBusinessModel: first(offering.sellerBusinessModel, raw.businessModel, interpretation.business_model),
    offeringName: usePack
      ? first(offering.name, offering.offeringName, offering.title, input.pack?.offeringKey)
      : first(raw.offeringName, raw.offering, interpretation.offering_name),
    offeringCategory: usePack
      ? first(offering.category, offering.offeringCategory, offering.type)
      : first(raw.offeringCategory, raw.category, interpretation.offering_category),
    offeringDescription: usePack
      ? first(offering.description, offering.offeringDescription, offering.summary)
      : first(raw.offeringDescription, raw.offeringDetails, raw.productOrServiceDescription, interpretation.offering_description),
    offeringCapabilities: usePack ? list(offering.capabilities ?? offering.offeringCapabilities) : list(
      raw.offeringCapabilities ?? interpretation.offering_capabilities ?? raw.problemsSolved ?? raw.majorDifferentiators,
    ),
    offeringExclusions: usePack ? list(offering.exclusions ?? offering.offeringExclusions) : list(raw.offeringExclusions ?? interpretation.offering_exclusions),
    source: usePack ? "INTELLIGENCE_PACK" : input.twin ? "BUSINESS_TWIN" : "NONE",
  };
  return { ...context, fingerprint: fingerprint(context) };
}

export async function resolveSellerContext(projectId: string): Promise<{ context: SellerContext; sufficiency: SellerContextSufficiency }> {
  const resolved = await resolveProjectSellerContext(projectId);
  return { context: resolved.context, sufficiency: resolved.sufficiency };
}

/** Read-only authoritative project context resolver. It never falls back across tenants. */
export async function resolveProjectSellerContext(projectId: string, expectedOrganizationId?: string): Promise<ProjectSellerContext> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  const [twinRows, icpRows, activeRows] = await Promise.all([
    db.select().from(businessTwinVersionsTable).where(eq(businessTwinVersionsTable.projectId, projectId)).orderBy(desc(businessTwinVersionsTable.version)).limit(1),
    db.select().from(icpVersionsTable).where(eq(icpVersionsTable.projectId, projectId)).orderBy(desc(icpVersionsTable.version)).limit(1),
    db.select({ pack: intelligencePacksTable, version: intelligencePackVersionsTable })
      .from(intelligencePacksTable).innerJoin(intelligencePackVersionsTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id))
      .where(and(eq(intelligencePacksTable.projectId, projectId), eq(intelligencePackVersionsTable.status, "ACTIVATED")))
      .orderBy(desc(intelligencePackVersionsTable.version)).limit(1),
  ]);
  const twin = twinRows[0];
  const icp = icpRows[0];
  const active = activeRows[0];
  return evaluateProjectReadiness({
    projectId, organizationId: project?.organizationId ?? null, expectedOrganizationId,
    twin: twin ?? null, icp: icp ?? null, pack: active?.pack, packVersion: active?.version,
  });
}