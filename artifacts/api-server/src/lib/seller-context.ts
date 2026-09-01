import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  businessTwinVersionsTable,
  db,
  icpVersionsTable,
  intelligencePackVersionsTable,
  intelligencePacksTable,
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

export function sellerContextSufficiency(context: Pick<SellerContext, "offeringName" | "offeringDescription" | "offeringCapabilities">): SellerContextSufficiency {
  const offering = context.offeringName?.trim().toLowerCase() ?? "";
  if (!offering) return { sufficient: false, reason: "MISSING_OFFERING" };
  if (PLACEHOLDERS.has(offering)) return { sufficient: false, reason: "GENERIC_PLACEHOLDER" };
  // A proper name alone is meaningful, but a generic product noun is not.
  if (/^(offering|service|services|solution|product)$/i.test(offering)) return { sufficient: false, reason: "GENERIC_PLACEHOLDER" };
  return { sufficient: true, reason: "SUFFICIENT" };
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
  const usePack = Boolean(input.packVersion);
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
      : first(raw.offeringDescription, raw.offeringDetails, interpretation.offering_description),
    offeringCapabilities: usePack ? list(offering.capabilities ?? offering.offeringCapabilities) : list(raw.offeringCapabilities ?? interpretation.offering_capabilities),
    offeringExclusions: usePack ? list(offering.exclusions ?? offering.offeringExclusions) : list(raw.offeringExclusions ?? interpretation.offering_exclusions),
    source: usePack ? "INTELLIGENCE_PACK" : input.twin ? "BUSINESS_TWIN" : "NONE",
  };
  return { ...context, fingerprint: fingerprint(context) };
}

export async function resolveSellerContext(projectId: string): Promise<{ context: SellerContext; sufficiency: SellerContextSufficiency }> {
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
  const context = assembleSellerContext({ twin: twin ?? null, icp: icp ?? null, pack: active?.pack, packVersion: active?.version });
  return { context, sufficiency: sellerContextSufficiency(context) };
}