import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  companiesTable,
  contactEnrichmentAttemptsTable,
  db,
  peopleTable,
  personEvidenceTable,
  projectCompaniesTable,
  projectPersonContextTable,
} from "@workspace/db";
import type {
  EmailLookupResult,
  PhoneLookupResult,
  ProviderCapability,
  ProviderResponse,
} from "./provider-contract";
import { ProviderRouter } from "./provider-router";

export type ContactEnrichmentCapability = "EMAIL_LOOKUP" | "PHONE_LOOKUP";
export type ContactStatus = "UNKNOWN" | "FOUND" | "VERIFIED" | "UNVERIFIED" | "INVALID";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9][0-9\s().-]{5,24}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function contactStatus(confidence: "verified" | "unverified" | "unknown", valid: boolean): ContactStatus {
  if (!valid) return "INVALID";
  if (confidence === "verified") return "VERIFIED";
  if (confidence === "unverified") return "UNVERIFIED";
  return "FOUND";
}

function attemptStatus(response: ProviderResponse<unknown>) {
  if (response.status === "failed") return "FAILED" as const;
  if (response.status === "empty" || response.usage.resultCount === 0) return "EMPTY" as const;
  return "SUCCEEDED" as const;
}

export function canEnrichContact(priority: string, requestedExplicitly: boolean) {
  return priority === "HIGH" || requestedExplicitly;
}

export async function listProjectPeople(projectId: string, projectCompanyId: string) {
  const rows = await db.select({
    context: projectPersonContextTable,
    person: peopleTable,
  }).from(projectPersonContextTable)
    .innerJoin(peopleTable, eq(projectPersonContextTable.personId, peopleTable.id))
    .where(and(
      eq(projectPersonContextTable.projectId, projectId),
      eq(projectPersonContextTable.projectCompanyId, projectCompanyId),
    ))
    .orderBy(desc(projectPersonContextTable.priority), peopleTable.canonicalName);
  const personIds = rows.map(({ person }) => person.id);
  const attempts = personIds.length
    ? await db.select().from(contactEnrichmentAttemptsTable)
      .where(and(
        eq(contactEnrichmentAttemptsTable.projectId, projectId),
        eq(contactEnrichmentAttemptsTable.projectCompanyId, projectCompanyId),
      ))
      .orderBy(desc(contactEnrichmentAttemptsTable.createdAt))
    : [];
  return rows.map(({ person, context }) => ({
    person: {
      id: person.id,
      name: person.canonicalName,
      title: person.defaultTitle,
      function: person.defaultFunction,
      seniority: person.defaultSeniority,
      profileUrl: person.profileUrl,
      source: person.source,
      visibility: person.visibility,
    },
    context: {
      role: context.role,
      roleLabel: context.roleLabel,
      roleConfidence: context.roleConfidence,
      priority: context.priority,
      email: context.email,
      emailStatus: context.emailStatus,
      phone: context.phone,
      phoneStatus: context.phoneStatus,
      lastEnrichedAt: context.lastEnrichedAt?.toISOString() ?? null,
    },
    attempts: attempts
      .filter((attempt) => attempt.personId === person.id)
      .map((attempt) => ({
        id: attempt.id,
        capability: attempt.capability,
        status: attempt.status,
        contactStatus: attempt.contactStatus,
        providerId: attempt.providerId,
        estimatedCost: attempt.estimatedCost,
        actualCost: attempt.actualCost,
        observedAt: attempt.observedAt.toISOString(),
      })),
  }));
}

export async function createPrivateProjectPerson(input: {
  organizationId: string;
  projectId: string;
  projectCompanyId: string;
  name: string;
  title?: string | null;
  role: "ECONOMIC_BUYER" | "CHAMPION" | "TECHNICAL_EVALUATOR" | "INFLUENCER" | "USER" | "PROCUREMENT" | "OTHER";
  roleLabel: string;
  roleConfidence: number;
  priority: "HIGH" | "MEDIUM" | "LOW";
}) {
  const [projectCompany] = await db.select()
    .from(projectCompaniesTable)
    .where(and(
      eq(projectCompaniesTable.id, input.projectCompanyId),
      eq(projectCompaniesTable.projectId, input.projectId),
    ))
    .limit(1);
  if (!projectCompany) return null;
  return db.transaction(async (tx) => {
    const [person] = await tx.insert(peopleTable).values({
      canonicalName: input.name.trim(),
      normalizedName: input.name.trim().toLowerCase().replace(/\s+/g, " "),
      defaultTitle: input.title?.trim() || null,
      visibility: "PRIVATE",
      source: "CUSTOMER_PROVIDED",
      ownerOrganizationId: input.organizationId,
    }).returning();
    const [context] = await tx.insert(projectPersonContextTable).values({
      projectId: input.projectId,
      projectCompanyId: input.projectCompanyId,
      personId: person.id,
      role: input.role,
      roleLabel: input.roleLabel.trim(),
      roleConfidence: input.roleConfidence,
      priority: input.priority,
      source: "CUSTOMER_PROVIDED",
    }).returning();
    return { person, context };
  });
}

async function enrichCapability(input: {
  organizationId: string;
  projectId: string;
  projectCompanyId: string;
  personId: string;
  requestedExplicitly: boolean;
  capability: ContactEnrichmentCapability;
  router: ProviderRouter;
  now: Date;
  person: typeof peopleTable.$inferSelect;
  context: typeof projectPersonContextTable.$inferSelect;
  company: typeof companiesTable.$inferSelect;
}) {
  const requestId = `contact:${input.projectId}:${input.personId}:${input.capability}:${randomUUID()}`;
  const request = {
    requestId,
    personName: input.person.canonicalName,
    companyName: input.company.canonicalName,
    domain: input.company.domain ?? undefined,
    profileUrl: input.person.profileUrl ?? undefined,
    metadata: {
      projectId: input.projectId,
      projectCompanyId: input.projectCompanyId,
      personId: input.personId,
    },
  };
  const response = await input.router.routeWaterfall(
    input.capability,
    request,
    (candidate) => {
      if (candidate.status !== "success" || !candidate.data) return false;
      return input.capability === "EMAIL_LOOKUP"
        ? (candidate.data as EmailLookupResult).emails.length > 0
        : (candidate.data as PhoneLookupResult).phones.length > 0;
    },
  );
  const candidate = input.capability === "EMAIL_LOOKUP"
    ? (response.data as EmailLookupResult | null)?.emails[0] ?? null
    : (response.data as PhoneLookupResult | null)?.phones[0] ?? null;
  const value = candidate
    ? input.capability === "EMAIL_LOOKUP"
      ? (candidate as EmailLookupResult["emails"][number]).address
      : (candidate as PhoneLookupResult["phones"][number]).number
    : null;
  const confidence = candidate?.confidence ?? "unknown";
  const valid = value
    ? input.capability === "EMAIL_LOOKUP" ? emailPattern.test(value) : phonePattern.test(value)
    : false;
  const status: ContactStatus = value ? contactStatus(confidence, valid) : "UNKNOWN";
  const sourceUrl = candidate?.sourceUrl ??
    response.sources.find((source) => source.kind === "public_url")?.reference ??
    null;

  await db.transaction(async (tx) => {
    await tx.insert(contactEnrichmentAttemptsTable).values({
      organizationId: input.organizationId,
      projectId: input.projectId,
      projectCompanyId: input.projectCompanyId,
      personId: input.personId,
      providerId: uuidPattern.test(response.providerId) ? response.providerId : null,
      capability: input.capability,
      status: attemptStatus(response),
      contactStatus: status,
      result: {
        found: Boolean(value),
        verification: status,
        sourceUrl,
        resultCount: response.usage.resultCount,
        errorCode: response.error?.code ?? null,
      },
      estimatedCost: response.usage.estimatedCost,
      actualCost: response.usage.actualCost,
      providerRequestId: response.providerRequestId,
      requestedExplicitly: input.requestedExplicitly,
      observedAt: input.now,
    });
    await tx.update(projectPersonContextTable).set({
      ...(input.capability === "EMAIL_LOOKUP"
        ? { ...(value ? { email: value } : {}), emailStatus: status }
        : { ...(value ? { phone: value } : {}), phoneStatus: status }),
      lastEnrichedAt: input.now,
    }).where(eq(projectPersonContextTable.id, input.context.id));
    if (value) {
      await tx.insert(personEvidenceTable).values({
        personId: input.personId,
        companyId: input.company.id,
        createdByOrganizationId: input.organizationId,
        sourceUrl,
        provider: response.providerId,
        claim: `${input.capability === "EMAIL_LOOKUP" ? "Email" : "Phone"} contact returned for ${input.person.canonicalName}.`,
        observedAt: input.now,
        visibility: "PRIVATE",
        metadata: {
          capability: input.capability,
          providerRequestId: response.providerRequestId,
          verification: status,
        },
      });
    }
  });

  return {
    capability: input.capability,
    provider: response.providerId,
    cost: {
      estimated: response.usage.estimatedCost,
      actual: response.usage.actualCost,
    },
    result: value,
    verification: status,
    timestamp: input.now.toISOString(),
    responseStatus: response.status,
    error: response.error,
  };
}

export async function enrichPersonContact(input: {
  organizationId: string;
  projectId: string;
  projectCompanyId: string;
  personId: string;
  requestedExplicitly: boolean;
  includePhone: boolean;
  router?: ProviderRouter;
  now?: Date;
}) {
  const [target] = await db.select({
    context: projectPersonContextTable,
    person: peopleTable,
    projectCompany: projectCompaniesTable,
    company: companiesTable,
  }).from(projectPersonContextTable)
    .innerJoin(peopleTable, eq(projectPersonContextTable.personId, peopleTable.id))
    .innerJoin(projectCompaniesTable, eq(projectPersonContextTable.projectCompanyId, projectCompaniesTable.id))
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(and(
      eq(projectPersonContextTable.projectId, input.projectId),
      eq(projectPersonContextTable.projectCompanyId, input.projectCompanyId),
      eq(projectPersonContextTable.personId, input.personId),
      eq(projectCompaniesTable.projectId, input.projectId),
    ))
    .limit(1);
  if (!target) return { kind: "not_found" as const };
  if (!canEnrichContact(target.context.priority, input.requestedExplicitly)) {
    return { kind: "not_eligible" as const, reason: "Only high-priority people or explicit user requests may be enriched." };
  }
  const router = input.router ?? new ProviderRouter();
  const now = input.now ?? new Date();
  const base = {
    ...input,
    router,
    now,
    person: target.person,
    context: target.context,
    company: target.company,
  };
  const results = [await enrichCapability({ ...base, capability: "EMAIL_LOOKUP" })];
  if (input.includePhone) results.push(await enrichCapability({ ...base, capability: "PHONE_LOOKUP" }));
  return {
    kind: "completed" as const,
    personId: input.personId,
    requestedExplicitly: input.requestedExplicitly,
    results,
  };
}