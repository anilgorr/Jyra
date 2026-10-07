import { and, desc, eq } from "drizzle-orm";
import {
  companiesTable, contactEnrichmentAttemptsTable, dataProvidersTable, db, instantLeadRunLeadsTable, instantLeadRunsTable, peopleTable,
  personCompanyRolesTable, projectCompaniesTable, projectPersonContextTable, signalPacksTable,
  type BuyingRole, type BuyingRoles, type InstantLeadContactStatus, type InstantLeadRun, type InstantLeadRunLead, type Project,
} from "@workspace/db";
import { creditSummary, InsufficientCreditsError, postCreditEntry } from "../credits";
import { resolveOrganizationPlan } from "../plans";
import { enrichPersonContact } from "../contact-enrichment";
import { all, condition, CrustdataError, crustdataFailureMessage, type CrustdataClient, type CrustdataPerson } from "./crustdata-client";
import { INSTANT_LEADS_ACTION, InstantLeadRequestError } from "./run";

/**
 * "Show contact": the right person at a delivered lead, with a business
 * email and a LinkedIn profile, for credits.
 *
 * The pack says who buys (its buying roles, in preference order, plus the
 * founder fallback for small companies). One Crustdata person search per
 * reveal brings back the company's senior people; the best match by role
 * and title wins. One Contact Enrich call brings the verified email. When
 * Crustdata has no email, the existing provider waterfall (Explee) is tried.
 *
 * Pricing is by outcome, after the fact: a deliverable email costs the
 * plan's verified price, a catch-all address the catch-all price, a name
 * with a LinkedIn profile but no email costs nothing, and a company where
 * nobody fitting the roles was found costs nothing. A second click on the
 * same lead is free: the reveal is stored on the lead row.
 */

export type RevealedContact = {
  status: InstantLeadContactStatus;
  credits: number;
  person: { id: string; name: string; title: string | null; email: string | null; emailStatus: string; linkedinUrl: string | null; roleLabel: string } | null;
};

export type ContactDeps = {
  client: CrustdataClient;
  /** The provider waterfall for an email when Crustdata has none; injected so tests need no router. */
  fallbackEmail: (input: { organizationId: string; projectId: string; projectCompanyId: string; personId: string; now: Date }) => Promise<{ email: string; status: "VERIFIED" | "FOUND" } | null>;
  now: () => Date;
  /** People fetched per reveal; one page is enough for a 10–200 person company. */
  peopleLimit: number;
};

export const DEFAULT_CONTACT_DEPS: Omit<ContactDeps, "client"> = {
  fallbackEmail: async (input) => {
    const result = await enrichPersonContact({ ...input, requestedExplicitly: true, includePhone: false, now: input.now });
    if (result.kind !== "completed") return null;
    const [context] = await db.select({ email: projectPersonContextTable.email, status: projectPersonContextTable.emailStatus }).from(projectPersonContextTable)
      .where(and(eq(projectPersonContextTable.projectId, input.projectId), eq(projectPersonContextTable.projectCompanyId, input.projectCompanyId), eq(projectPersonContextTable.personId, input.personId))).limit(1);
    if (!context?.email) return null;
    if (context.status === "VERIFIED") return { email: context.email, status: "VERIFIED" };
    if (context.status === "FOUND" || context.status === "UNVERIFIED") return { email: context.email, status: "FOUND" };
    return null;
  },
  now: () => new Date(),
  peopleLimit: 25,
};

/** Crustdata's levels, most senior first. */
const SENIORITY_ORDER = ["cxo", "owner / partner", "vice president", "director", "manager"];

const FOUNDER_ROLE: BuyingRole = { label: "Founder", seniorityLevels: ["CXO", "Owner / Partner"], functionCategories: [], titleKeywords: ["founder", "co-founder", "ceo", "managing director", "owner", "managing partner"] };

/** The roles to look for at this company, in order: the founder first when it is small, then the pack's roles. */
export function rolesFor(buying: BuyingRoles | null | undefined, headcount: number | null): BuyingRole[] {
  const roles = buying?.roles?.length ? buying.roles : [];
  const founder: BuyingRole = { ...FOUNDER_ROLE, titleKeywords: buying?.fallbackTitles?.length ? buying.fallbackTitles : FOUNDER_ROLE.titleKeywords };
  const small = headcount !== null && headcount < (buying?.fallbackUnderHeadcount ?? 50);
  const withoutFounder = roles.filter((role) => role.label.toLowerCase() !== "founder");
  return small ? [founder, ...withoutFounder] : [...withoutFounder, founder];
}

/** The one search that covers every role: current employer by domain, any of the roles' seniority levels. */
export function personSearchFilters(domain: string, roles: BuyingRole[]) {
  const seniorities = [...new Set(roles.flatMap((role) => role.seniorityLevels))];
  const base = condition("experience.employment_details.current.company_website_domain", "=", domain);
  return seniorities.length ? all(base, condition("experience.employment_details.current.seniority_level", "in", seniorities)) : all(base);
}

/**
 * Pure: which of the people found is the buyer. Roles in order; within a
 * role a title keyword beats a function match beats a seniority match; ties
 * go to the more senior person, then to one with a business email on file.
 */
export function pickBuyer(people: CrustdataPerson[], roles: BuyingRole[]): { person: CrustdataPerson; role: BuyingRole; reason: string } | null {
  const lower = (value: string | null) => (value ?? "").toLowerCase();
  for (const role of roles) {
    const scored = people.map((person) => {
      const title = lower(person.title);
      const keyword = role.titleKeywords.find((word) => title.includes(word.toLowerCase()));
      const fn = role.functionCategories.some((category) => lower(person.functionCategory) === category.toLowerCase());
      const seniority = role.seniorityLevels.some((level) => lower(person.seniority) === level.toLowerCase());
      const rank = SENIORITY_ORDER.indexOf(lower(person.seniority));
      // Within a role: title keyword, then function, then level, then the most senior, then whoever has an email on file.
      const score = (keyword ? 100 : 0) + (fn ? 10 : 0) + (seniority ? 1 : 0) + (rank >= 0 ? (SENIORITY_ORDER.length - rank) * 0.1 : 0) + (person.hasBusinessEmail ? 0.05 : 0);
      const reason = keyword ? `title matches "${keyword}"` : fn ? `${person.functionCategory} function at ${person.seniority} level` : seniority ? `${person.seniority} level` : "";
      // Eligible: the title says so, or the level fits and (where the role names functions) the function fits.
      const eligible = Boolean(keyword) || (seniority && (role.functionCategories.length === 0 || fn));
      return { person, score, reason, eligible };
    }).filter((entry) => entry.eligible).sort((left, right) => right.score - left.score);
    const best = scored[0];
    if (best && best.person.linkedinUrl) return { person: best.person, role, reason: best.reason };
  }
  return null;
}

const inFlight = new Set<string>();

export async function revealLeadContact(input: { project: Project; run: InstantLeadRun; lead: InstantLeadRunLead; userId: string; deps: ContactDeps }): Promise<RevealedContact> {
  const { project, run, lead, deps } = input;
  if (lead.contactStatus !== "NONE") return existingContact(lead);
  if (inFlight.has(lead.id)) throw new InstantLeadRequestError("RUN_ACTIVE", "This contact is being fetched; try again in a moment.", 409);
  inFlight.add(lead.id);
  try {
    const now = deps.now();
    const [plan, credits] = await Promise.all([resolveOrganizationPlan(project.organizationId), creditSummary(project.organizationId)]);
    if (credits.balance < plan.creditsPerContactVerified) {
      throw new InstantLeadRequestError("INSUFFICIENT_CREDITS", `Showing a contact can cost up to ${plan.creditsPerContactVerified} credits; you have ${credits.balance}.`, 402);
    }
    const [target] = await db.select({ projectCompany: projectCompaniesTable, company: companiesTable }).from(projectCompaniesTable)
      .innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
      .where(eq(projectCompaniesTable.id, lead.projectCompanyId)).limit(1);
    if (!target) throw new InstantLeadRequestError("BAD_REQUEST", "This lead's company is no longer on the project", 400);
    const domain = target.company.domain?.toLowerCase().replace(/^www\./, "");
    if (!domain) return record({ lead, status: "NOT_FOUND", credits: 0, person: null, attempt: null, now, userId: input.userId, run });
    const pack = run.signalPackId ? (await db.select({ buyingRoles: signalPacksTable.buyingRoles }).from(signalPacksTable).where(eq(signalPacksTable.id, run.signalPackId)).limit(1))[0] : null;
    const roles = rolesFor(pack?.buyingRoles ?? null, target.company.employeeCount);
    const scope = { organizationId: project.organizationId, projectId: project.id, projectCompanyId: lead.projectCompanyId, metadata: { instantLeadRunId: run.id, leadId: lead.id } };

    let providerCostUsd = 0;
    let found: ReturnType<typeof pickBuyer>;
    try {
      const search = await deps.client.searchPeople({ filters: personSearchFilters(domain, roles), limit: deps.peopleLimit }, scope);
      providerCostUsd += search.costUsd;
      found = pickBuyer(search.items, roles);
    } catch (error) {
      if (error instanceof CrustdataError) throw new InstantLeadRequestError("PROVIDER_NOT_CONFIGURED", crustdataFailureMessage(error), 503);
      throw error;
    }
    if (!found) return record({ lead, status: "NOT_FOUND", credits: 0, person: null, attempt: { cost: providerCostUsd, result: { roles: roles.map((role) => role.label), domain } }, now, userId: input.userId, run });

    // Persist the person first: the email, from whichever provider, attaches to a row that exists.
    const persisted = await persistPerson({ project, lead, found, now });

    let email: { email: string; status: "deliverable" | "catch_all" } | null = null;
    try {
      const enriched = await deps.client.enrichContact({ linkedinUrl: found.person.linkedinUrl!, verified: true }, scope);
      providerCostUsd += enriched.costUsd;
      const emails = enriched.contact?.emails ?? [];
      const deliverable = emails.find((item) => item.status === "deliverable");
      const catchAll = emails.find((item) => item.status === "catch_all");
      email = deliverable ? { email: deliverable.email, status: "deliverable" } : catchAll ? { email: catchAll.email, status: "catch_all" } : null;
    } catch (error) {
      if (!(error instanceof CrustdataError)) throw error;
      // A failed enrich is not a failed reveal: the person is known; the fallback may still find the email.
    }
    if (!email) {
      const fallback = await deps.fallbackEmail({ organizationId: project.organizationId, projectId: project.id, projectCompanyId: lead.projectCompanyId, personId: persisted.personId, now }).catch(() => null);
      if (fallback) email = { email: fallback.email, status: fallback.status === "VERIFIED" ? "deliverable" : "catch_all" };
    }

    const status: InstantLeadContactStatus = email ? (email.status === "deliverable" ? "VERIFIED" : "CATCH_ALL") : "NAME_ONLY";
    const price = status === "VERIFIED" ? plan.creditsPerContactVerified : status === "CATCH_ALL" ? plan.creditsPerContactCatchAll : 0;
    await db.update(projectPersonContextTable).set({
      ...(email ? { email: email.email, emailStatus: email.status === "deliverable" ? "VERIFIED" : "FOUND" } : {}), lastEnrichedAt: now, updatedAt: now,
    }).where(eq(projectPersonContextTable.id, persisted.contextId));
    return record({
      lead, status, credits: price, now, userId: input.userId, run,
      person: { id: persisted.personId, name: found.person.name ?? "Unknown", title: found.person.title, email: email?.email ?? null, emailStatus: email ? (email.status === "deliverable" ? "VERIFIED" : "FOUND") : "UNKNOWN", linkedinUrl: found.person.linkedinUrl, roleLabel: found.role.label },
      attempt: { cost: providerCostUsd, result: { roleLabel: found.role.label, reason: found.reason, crustdataPersonId: found.person.id, emailStatus: email?.status ?? "none" } },
    });
  } finally {
    inFlight.delete(lead.id);
  }
}

async function existingContact(lead: InstantLeadRunLead): Promise<RevealedContact> {
  if (!lead.contactPersonId) return { status: lead.contactStatus, credits: lead.contactCredits, person: null };
  const [row] = await db.select({ person: peopleTable, context: projectPersonContextTable }).from(peopleTable)
    .leftJoin(projectPersonContextTable, and(eq(projectPersonContextTable.personId, peopleTable.id), eq(projectPersonContextTable.projectCompanyId, lead.projectCompanyId)))
    .where(eq(peopleTable.id, lead.contactPersonId)).limit(1);
  if (!row) return { status: lead.contactStatus, credits: lead.contactCredits, person: null };
  return {
    status: lead.contactStatus, credits: lead.contactCredits,
    person: { id: row.person.id, name: row.person.canonicalName, title: row.person.defaultTitle, email: row.context?.email ?? null, emailStatus: row.context?.emailStatus ?? "UNKNOWN", linkedinUrl: row.person.profileUrl, roleLabel: row.context?.roleLabel ?? "" },
  };
}

/** People are shared across organisations by LinkedIn profile; the project context (role, email) is the customer's own. */
async function persistPerson(input: { project: Project; lead: InstantLeadRunLead; found: NonNullable<ReturnType<typeof pickBuyer>>; now: Date }): Promise<{ personId: string; contextId: string }> {
  const { found, lead, project, now } = input;
  const name = (found.person.name ?? "Unknown").trim();
  const profileUrl = found.person.linkedinUrl!;
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(peopleTable).where(eq(peopleTable.profileUrl, profileUrl)).limit(1);
    const person = existing ?? (await tx.insert(peopleTable).values({
      canonicalName: name, normalizedName: name.toLowerCase().replace(/\s+/g, " "), defaultTitle: found.person.title, defaultFunction: found.person.functionCategory, defaultSeniority: found.person.seniority,
      profileUrl, visibility: "PUBLIC", source: "EXTERNAL",
    }).onConflictDoNothing({ target: peopleTable.profileUrl }).returning())[0]
      ?? (await tx.select().from(peopleTable).where(eq(peopleTable.profileUrl, profileUrl)).limit(1))[0]!;
    if (existing && (found.person.title && existing.defaultTitle !== found.person.title)) {
      await tx.update(peopleTable).set({ defaultTitle: found.person.title, defaultFunction: found.person.functionCategory, defaultSeniority: found.person.seniority, updatedAt: now }).where(eq(peopleTable.id, existing.id));
    }
    const role = found.role.label.toLowerCase() === "founder" ? "ECONOMIC_BUYER" : "CHAMPION";
    await tx.insert(personCompanyRolesTable).values({ personId: person.id, companyId: lead.companyId, role, roleLabel: found.role.label, confidence: 0.8, evidenceSupported: "PROVIDER" })
      .onConflictDoNothing({ target: [personCompanyRolesTable.personId, personCompanyRolesTable.companyId, personCompanyRolesTable.role] });
    const [context] = await tx.insert(projectPersonContextTable).values({
      projectId: project.id, projectCompanyId: lead.projectCompanyId, personId: person.id, role, roleLabel: found.role.label, roleConfidence: 0.8, priority: "HIGH", source: "EXTERNAL",
    }).onConflictDoUpdate({ target: [projectPersonContextTable.projectId, projectPersonContextTable.projectCompanyId, projectPersonContextTable.personId], set: { roleLabel: found.role.label, priority: "HIGH", updatedAt: now } }).returning();
    return { personId: person.id, contextId: context!.id };
  });
}

/** Charge by outcome, write the attempt, pin the result to the lead. */
async function record(input: {
  lead: InstantLeadRunLead; run: InstantLeadRun; status: InstantLeadContactStatus; credits: number; now: Date; userId: string;
  person: RevealedContact["person"]; attempt: { cost: number; result: Record<string, unknown> } | null;
}): Promise<RevealedContact> {
  const { lead, run, status, credits, now, person } = input;
  let entryId: string | null = null;
  if (credits > 0) {
    try {
      const entry = await postCreditEntry({
        organizationId: run.organizationId, kind: "debit", delta: -credits,
        description: `Instant Leads: contact revealed (${status === "VERIFIED" ? "verified email" : "catch-all email"})`,
        context: { action: INSTANT_LEADS_ACTION, stage: "contact", runId: run.id, leadId: lead.id, projectCompanyId: lead.projectCompanyId, status },
        createdByUserId: input.userId,
      });
      entryId = entry.entryId;
    } catch (error) {
      if (error instanceof InsufficientCreditsError) throw new InstantLeadRequestError("INSUFFICIENT_CREDITS", `This contact costs ${credits} credits; you have ${error.balance}.`, 402);
      throw error;
    }
  }
  if (input.attempt && person) {
    const [provider] = await db.select({ id: dataProvidersTable.id }).from(dataProvidersTable).where(eq(dataProvidersTable.providerType, "crustdata")).limit(1);
    await db.insert(contactEnrichmentAttemptsTable).values({
      organizationId: run.organizationId, projectId: run.projectId, projectCompanyId: lead.projectCompanyId, personId: person.id, providerId: provider?.id ?? null,
      capability: "EMAIL_LOOKUP", status: person.email ? "SUCCEEDED" : "EMPTY", contactStatus: person.emailStatus === "VERIFIED" ? "VERIFIED" : person.email ? "FOUND" : "UNKNOWN",
      result: input.attempt.result, estimatedCost: input.attempt.cost, actualCost: input.attempt.cost, requestedExplicitly: true, observedAt: now,
    });
  }
  await db.update(instantLeadRunLeadsTable).set({ contactStatus: status, contactPersonId: person?.id ?? null, contactCredits: credits, contactEntryId: entryId, contactRevealedAt: now })
    .where(eq(instantLeadRunLeadsTable.id, lead.id));
  return { status, credits, person };
}

/** The lead row, scoped to its run and project. */
export async function loadLead(projectId: string, runId: string, leadId: string): Promise<{ run: InstantLeadRun; lead: InstantLeadRunLead } | null> {
  const [row] = await db.select({ run: instantLeadRunsTable, lead: instantLeadRunLeadsTable }).from(instantLeadRunLeadsTable)
    .innerJoin(instantLeadRunsTable, eq(instantLeadRunsTable.id, instantLeadRunLeadsTable.runId))
    .where(and(eq(instantLeadRunLeadsTable.id, leadId), eq(instantLeadRunLeadsTable.runId, runId), eq(instantLeadRunLeadsTable.projectId, projectId)))
    .orderBy(desc(instantLeadRunLeadsTable.createdAt)).limit(1);
  return row ?? null;
}
