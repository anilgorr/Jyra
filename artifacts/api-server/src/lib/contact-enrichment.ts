import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, ne } from "drizzle-orm";
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
import {
  recordResearchRequest,
  releaseResearchReservation,
  reserveResearchBudget,
} from "./research-economics";

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

/**
 * Idempotency key for a paid contact lookup: one reservation per
 * person + project company + capability per UTC day. Repeated clicks or
 * retries within the day reuse the same key instead of paying again.
 */
export function contactEnrichmentAttemptKey(input: {
  projectId: string;
  projectCompanyId: string;
  personId: string;
  capability: ContactEnrichmentCapability;
  now: Date;
}): string {
  const day = input.now.toISOString().slice(0, 10);
  return `contact:${input.projectId}:${input.projectCompanyId}:${input.personId}:${input.capability}:${day}`;
}

function startOfUtcDay(now: Date): Date {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  return date;
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
  const attemptKey = contactEnrichmentAttemptKey(input);
  // Dedupe: a non-failed attempt for this person/capability today is reused
  // rather than paying the provider waterfall again.
  const [priorAttempt] = await db.select().from(contactEnrichmentAttemptsTable)
    .where(and(
      eq(contactEnrichmentAttemptsTable.projectId, input.projectId),
      eq(contactEnrichmentAttemptsTable.projectCompanyId, input.projectCompanyId),
      eq(contactEnrichmentAttemptsTable.personId, input.personId),
      eq(contactEnrichmentAttemptsTable.capability, input.capability),
      ne(contactEnrichmentAttemptsTable.status, "FAILED"),
      gte(contactEnrichmentAttemptsTable.observedAt, startOfUtcDay(input.now)),
    ))
    .orderBy(desc(contactEnrichmentAttemptsTable.observedAt))
    .limit(1);
  if (priorAttempt) {
    const priorValue = input.capability === "EMAIL_LOOKUP" ? input.context.email : input.context.phone;
    return {
      capability: input.capability,
      provider: priorAttempt.providerId ?? "unknown",
      cost: { estimated: 0, actual: 0 },
      result: priorValue,
      verification: priorAttempt.contactStatus as ContactStatus,
      timestamp: priorAttempt.observedAt.toISOString(),
      responseStatus: priorAttempt.status === "SUCCEEDED" ? "success" as const : "empty" as const,
      error: null,
      deduplicated: true as const,
      budgetBlocked: false as const,
    };
  }

  // Reserve budget before any paid call. The reservation is keyed by the
  // idempotency key so concurrent duplicates share one reservation.
  const estimatedCost = Math.max(0, await input.router.maximumEstimatedCost(input.capability));
  const budget = await reserveResearchBudget({
    organizationId: input.organizationId,
    projectId: input.projectId,
    companyId: input.company.id,
    attemptKey,
    estimatedCost,
    now: input.now,
  });
  if (!budget.allowed) {
    return {
      capability: input.capability,
      provider: "budget",
      cost: { estimated: estimatedCost, actual: 0 },
      result: null,
      verification: "UNKNOWN" as ContactStatus,
      timestamp: input.now.toISOString(),
      responseStatus: "empty" as const,
      error: { code: "BUDGET_EXCEEDED", message: budget.reason ?? "Research budget reached." },
      deduplicated: false as const,
      budgetBlocked: true as const,
    };
  }

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
  let response: ProviderResponse<unknown>;
  try {
    response = await input.router.routeWaterfall(
      input.capability,
      request,
      (candidate) => {
        if (candidate.status !== "success" || !candidate.data) return false;
        return input.capability === "EMAIL_LOOKUP"
          ? (candidate.data as EmailLookupResult).emails.length > 0
          : (candidate.data as PhoneLookupResult).phones.length > 0;
      },
    );
  } catch (error) {
    await releaseResearchReservation(attemptKey);
    throw error;
  }
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

  const providerId = uuidPattern.test(response.providerId) ? response.providerId : null;
  const completedAt = new Date();
  await recordResearchRequest({
    organizationId: input.organizationId,
    projectId: input.projectId,
    companyId: input.company.id,
    questionId: null,
    researchJobId: null,
    researchQuestion: `Contact ${input.capability} for person ${input.personId}`,
    providerCapability: input.capability,
    providerId,
    providerRequestId: response.providerRequestId,
    status: response.status,
    success: response.status === "success",
    latencyMs: response.usage.latencyMs,
    estimatedCost: response.usage.estimatedCost || estimatedCost,
    actualCost: response.usage.actualCost,
    resultMetadata: {
      personId: input.personId,
      projectCompanyId: input.projectCompanyId,
      resultCount: response.usage.resultCount,
      errorCode: response.error?.code ?? null,
    },
    startedAt: input.now,
    completedAt,
    attemptKey,
  });

  await db.transaction(async (tx) => {
    await tx.insert(contactEnrichmentAttemptsTable).values({
      organizationId: input.organizationId,
      projectId: input.projectId,
      projectCompanyId: input.projectCompanyId,
      personId: input.personId,
      providerId,
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
    deduplicated: false as const,
    budgetBlocked: false as const,
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
  if (results.every((result) => result.budgetBlocked)) {
    return {
      kind: "budget_blocked" as const,
      reason: results[0]?.error?.message ?? "Research budget reached.",
      personId: input.personId,
    };
  }
  return {
    kind: "completed" as const,
    personId: input.personId,
    requestedExplicitly: input.requestedExplicitly,
    deduplicated: results.every((result) => result.deduplicated),
    results,
  };
}