import { and, desc, eq, gte } from "drizzle-orm";
import {
  companiesTable,
  companyProvenanceTable,
  db,
  projectCompaniesTable,
  providerUsageTable,
  type Company,
} from "@workspace/db";
import { canonicalSourceIdentity } from "./evidence";
import type {
  CompanyFirmographicAttributes,
  CompanyFirmographicsResult,
  ProviderOperations,
  ProviderResponse,
} from "./provider-contract";

const DAY_MS = 86_400_000;
const DEFAULT_FRESHNESS_DAYS = 30;
const FIRMOGRAPHICS_SOURCE_TYPE = "COMPANY_FIRMOGRAPHICS";
const FIRMOGRAPHICS_REVIEW_SOURCE_TYPE = "COMPANY_FIRMOGRAPHICS_REVIEW";
const MAX_STORED_PAYLOAD_BYTES = 250_000;
const MAX_STORED_STRING_BYTES = 2_048;
const MAX_STORED_ARRAY_ITEMS = 25;

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
}

function storageSafeValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return truncateUtf8(value, MAX_STORED_STRING_BYTES);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_STORED_ARRAY_ITEMS).map((item) => storageSafeValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    if (depth >= 8) return { truncated: true };
    return Object.fromEntries(
      Object.entries(value).slice(0, 100)
        .map(([key, item]) => [key, storageSafeValue(item, depth + 1)]),
    );
  }
  return value;
}

function payloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

type FirmographicsCachePayload = {
  kind: "COMPANY_FIRMOGRAPHICS";
  cacheKey: string;
  providerId: string;
  result: CompanyFirmographicsResult;
  rawProviderResponse?: unknown;
  conflicts: Array<{ attribute: string; existingValue: unknown; observedValue: unknown }>;
  canonicalUpdated: boolean;
};

export type CompanyFirmographicsEnrichmentInput = {
  organizationId: string;
  projectId: string;
  companyId: string;
  router: Pick<ProviderOperations, "enrichCompany">;
  linkedinCompanyUrl?: string | null;
  linkedinCompanyUrlProvenance?: "CANONICAL_EXISTING" | "USER_VERIFIED" | "UNVERIFIED";
  approveProbable?: boolean;
  freshnessDays?: number;
  now?: Date;
};

export type CompanyFirmographicsEnrichment = {
  response: ProviderResponse<CompanyFirmographicsResult>;
  cacheHit: boolean;
  canonicalUpdated: boolean;
  conflicts: FirmographicsCachePayload["conflicts"];
};

function cacheIdentity(companyId: string, linkedinCompanyUrl: string): string {
  return `${companyId}:${canonicalSourceIdentity(linkedinCompanyUrl)}`;
}

function cachePayload(value: unknown): FirmographicsCachePayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<FirmographicsCachePayload>;
  return payload.kind === "COMPANY_FIRMOGRAPHICS" &&
    typeof payload.cacheKey === "string" &&
    typeof payload.providerId === "string" &&
    Boolean(payload.result)
    ? payload as FirmographicsCachePayload
    : null;
}

function cachedResponse(
  payload: FirmographicsCachePayload,
  now: Date,
): ProviderResponse<CompanyFirmographicsResult> {
  return {
    status: "success",
    providerId: payload.providerId,
    providerRequestId: `cache:${payload.cacheKey}`,
    data: payload.result,
    sources: payload.result.attributes.linkedinCompanyUrl
      ? [{
          kind: "public_url",
          reference: payload.result.attributes.linkedinCompanyUrl,
          capturedAt: now.toISOString(),
        }]
      : [],
    usage: {
      estimatedCost: 0,
      actualCost: 0,
      latencyMs: 0,
      runtimeMs: 0,
      resultCount: 1,
    },
    error: null,
    retryable: false,
    capturedAt: now.toISOString(),
    metadata: {
      cacheHit: true,
      originalProviderId: payload.providerId,
    },
  };
}

function canonicalUpdates(
  company: Company,
  attributes: CompanyFirmographicAttributes,
): {
  updates: Partial<typeof companiesTable.$inferInsert>;
  conflicts: FirmographicsCachePayload["conflicts"];
} {
  const mappings: Array<{
    attribute: string;
    current: unknown;
    observed: unknown;
    assign: (value: unknown) => void;
  }> = [];
  const updates: Partial<typeof companiesTable.$inferInsert> = {};
  mappings.push(
    { attribute: "website", current: company.website, observed: attributes.websiteUrl, assign: (value) => { updates.website = value as string; } },
    { attribute: "domain", current: company.domain, observed: attributes.canonicalDomain, assign: (value) => { updates.domain = value as string; } },
    { attribute: "linkedinUrl", current: company.linkedinUrl, observed: attributes.linkedinCompanyUrl, assign: (value) => { updates.linkedinUrl = value as string; } },
    { attribute: "country", current: company.country, observed: attributes.headquartersCountry, assign: (value) => { updates.country = value as string; } },
    { attribute: "industry", current: company.industry, observed: attributes.industry, assign: (value) => { updates.industry = value as string; } },
    { attribute: "employeeCount", current: company.employeeCount, observed: attributes.employeeCount, assign: (value) => { updates.employeeCount = value as number; } },
    { attribute: "employeeRange", current: company.employeeRange, observed: attributes.employeeRange, assign: (value) => { updates.employeeRange = value as string; } },
    { attribute: "description", current: company.description, observed: attributes.companyDescription, assign: (value) => { updates.description = value as string; } },
  );
  const conflicts: FirmographicsCachePayload["conflicts"] = [];
  for (const mapping of mappings) {
    if (mapping.observed === null || mapping.observed === undefined) continue;
    if (mapping.current === null || mapping.current === undefined || mapping.current === "") {
      mapping.assign(mapping.observed);
      continue;
    }
    if (String(mapping.current) !== String(mapping.observed)) {
      conflicts.push({
        attribute: mapping.attribute,
        existingValue: mapping.current,
        observedValue: mapping.observed,
      });
    }
  }
  if (attributes.linkedinCompanyUrl && !company.profileUrls.linkedin) {
    updates.profileUrls = { ...company.profileUrls, linkedin: attributes.linkedinCompanyUrl };
  }
  return { updates, conflicts };
}

async function projectCompany(input: {
  projectId: string;
  companyId: string;
}): Promise<Company> {
  const [row] = await db.select({ company: companiesTable })
    .from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(and(
      eq(projectCompaniesTable.projectId, input.projectId),
      eq(projectCompaniesTable.companyId, input.companyId),
    ))
    .limit(1);
  if (!row) throw new Error("Company is not available in this project");
  return row.company;
}

export async function enrichCompanyFirmographics(
  input: CompanyFirmographicsEnrichmentInput,
): Promise<CompanyFirmographicsEnrichment> {
  const now = input.now ?? new Date();
  const company = await projectCompany(input);
  const linkedinCompanyUrl = input.linkedinCompanyUrl ?? company.linkedinUrl;
  const linkedinCompanyUrlProvenance = input.linkedinCompanyUrlProvenance ??
    (linkedinCompanyUrl && company.linkedinUrl &&
      canonicalSourceIdentity(linkedinCompanyUrl) === canonicalSourceIdentity(company.linkedinUrl)
      ? "CANONICAL_EXISTING"
      : "UNVERIFIED");
  if (!linkedinCompanyUrl) {
    const response = await input.router.enrichCompany({
      companyId: company.id,
      companyName: company.canonicalName,
      canonicalDomain: company.domain,
      websiteUrl: company.website,
      linkedinCompanyUrl: null,
      linkedinCompanyUrlProvenance: "UNVERIFIED",
      country: company.country,
      requestId: `firmographics:${company.id}:${now.toISOString()}`,
      metadata: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        companyId: company.id,
      },
    });
    return { response, cacheHit: false, canonicalUpdated: false, conflicts: [] };
  }

  const cacheKey = cacheIdentity(company.id, linkedinCompanyUrl);
  const freshnessDays = Math.max(1, Math.min(365, input.freshnessDays ?? DEFAULT_FRESHNESS_DAYS));
  const [cached] = await db.select().from(companyProvenanceTable)
    .where(and(
      eq(companyProvenanceTable.projectId, input.projectId),
      eq(companyProvenanceTable.companyId, company.id),
      eq(companyProvenanceTable.sourceType, FIRMOGRAPHICS_SOURCE_TYPE),
      gte(companyProvenanceTable.observedAt, new Date(now.getTime() - freshnessDays * DAY_MS)),
    ))
    .orderBy(desc(companyProvenanceTable.observedAt), desc(companyProvenanceTable.createdAt))
    .limit(1);
  const cachedPayload = cachePayload(cached?.payload);
  if (cachedPayload?.cacheKey === cacheKey &&
    ["CONFIRMED", "PROBABLE"].includes(cachedPayload.result.entityMatchStatus)) {
    await db.insert(providerUsageTable).values({
      providerId: cachedPayload.providerId,
      capability: "COMPANY_FIRMOGRAPHICS",
      requestId: `cache:${cacheKey}:${now.toISOString()}`,
      status: "success",
      retryable: false,
      latencyMs: 0,
      runtimeMs: 0,
      resultCount: 1,
      estimatedCost: 0,
      actualCost: 0,
      metadata: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        companyId: company.id,
        cacheHit: true,
        originalProviderId: cachedPayload.providerId,
      },
      startedAt: now,
      completedAt: now,
    });
    return {
      response: cachedResponse(cachedPayload, now),
      cacheHit: true,
      canonicalUpdated: cachedPayload.canonicalUpdated,
      conflicts: cachedPayload.conflicts,
    };
  }

  const response = await input.router.enrichCompany({
    companyId: company.id,
    companyName: company.canonicalName,
    canonicalDomain: company.domain,
    websiteUrl: company.website,
    linkedinCompanyUrl,
    linkedinCompanyUrlProvenance,
    country: company.country,
    requestId: `firmographics:${company.id}:${now.toISOString()}`,
    metadata: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      companyId: company.id,
      cacheHit: "false",
    },
  });
  if (!response.data || response.status !== "success") {
    return { response, cacheHit: false, canonicalUpdated: false, conflicts: [] };
  }

  const result = storageSafeValue(response.data) as CompanyFirmographicsResult;
  if (result.entityMatchStatus === "WRONG") {
    return { response, cacheHit: false, canonicalUpdated: false, conflicts: [] };
  }
  const safeToUpdate = result.entityMatchStatus === "CONFIRMED" ||
    (result.entityMatchStatus === "PROBABLE" && input.approveProbable === true);
  const { updates, conflicts } = canonicalUpdates(company, result.attributes);
  const canonicalUpdated = safeToUpdate && Object.keys(updates).length > 0;
  let payload: FirmographicsCachePayload = {
    kind: "COMPANY_FIRMOGRAPHICS",
    cacheKey,
    providerId: response.providerId,
    result,
    rawProviderResponse: response.metadata?.rawProviderResponse,
    conflicts,
    canonicalUpdated,
  };
  if (payloadBytes(payload) > MAX_STORED_PAYLOAD_BYTES) {
    payload = {
      ...payload,
      rawProviderResponse: { omitted: true, reason: "PERSISTED_PAYLOAD_BYTE_LIMIT" },
    };
  }
  if (payloadBytes(payload) > MAX_STORED_PAYLOAD_BYTES) {
    throw new Error("Normalized firmographics payload exceeds the persistence byte limit");
  }
  await db.transaction(async (tx) => {
    if (safeToUpdate) {
      await tx.insert(companyProvenanceTable).values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        companyId: company.id,
        sourceType: FIRMOGRAPHICS_SOURCE_TYPE,
        sourceLabel: "LinkedIn Company Information via Bright Data",
        sourceUrl: result.attributes.linkedinCompanyUrl ?? linkedinCompanyUrl,
        observedAt: now,
        payload,
        visibility: "PRIVATE",
      });
      if (canonicalUpdated) {
        await tx.update(companiesTable).set({ ...updates, updatedAt: now })
          .where(eq(companiesTable.id, company.id));
      }
    } else if (result.entityMatchStatus === "AMBIGUOUS" || result.entityMatchStatus === "PROBABLE") {
      await tx.insert(companyProvenanceTable).values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        companyId: company.id,
        sourceType: FIRMOGRAPHICS_REVIEW_SOURCE_TYPE,
        sourceLabel: "LinkedIn Company Information via Bright Data",
        sourceUrl: result.attributes.linkedinCompanyUrl ?? linkedinCompanyUrl,
        observedAt: now,
        payload: { ...payload, canonicalUpdated: false },
        visibility: "PRIVATE",
      });
    }
  });
  return { response, cacheHit: false, canonicalUpdated, conflicts };
}