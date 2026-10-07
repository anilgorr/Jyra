import { and, eq, inArray } from "drizzle-orm";
import {
  companiesTable, creditRequestsTable, db, instantLeadRunLeadsTable, peopleTable, projectPersonContextTable,
  type InstantLeadRun, type InstantLeadRunLead,
} from "@workspace/db";

/**
 * The customer's view of a run and its leads. Field by field on purpose:
 * nothing priced in currency gets through, and the route parses the result
 * through the generated zod schema as a second fence.
 */

const STAGE_LABEL: Record<InstantLeadRun["status"], string> = {
  QUEUED: "Waiting to start", SEARCHING: "Searching your market", SCREENING: "Screening against your ICP",
  RESEARCHING: "Researching candidates", RANKING: "Ranking by intent", DONE: "Done", PARTIAL: "Done — fewer than asked",
  FAILED: "Stopped", CANCELLED: "Cancelled",
};

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

/** The customer's view of a run. Field by field on purpose: nothing priced in currency gets through. */
export function serializeRun(run: InstantLeadRun) {
  return {
    id: run.id, projectId: run.projectId, status: run.status, stage: STAGE_LABEL[run.status],
    working: ["QUEUED", "SEARCHING", "SCREENING", "RESEARCHING", "RANKING"].includes(run.status),
    requested: run.requested, delivered: run.delivered, confirmed: run.confirmed,
    candidatesFound: run.candidatesFound, candidatesAccepted: run.candidatesAccepted, researched: run.researched,
    etaSeconds: run.etaSeconds, widened: run.widened,
    credits: { perLead: run.creditsPerLead, held: run.creditsHeld, settled: run.creditsSettled },
    unmapped: run.filters?.unmapped ?? { industries: [], geographies: [] },
    errorCode: run.errorCode, outcomeNote: run.outcomeNote,
    requestedByUserId: run.requestedByUserId,
    createdAt: run.createdAt.toISOString(), startedAt: iso(run.startedAt), finishedAt: iso(run.finishedAt), updatedAt: run.updatedAt.toISOString(),
  };
}

export type SerializedLead = {
  id: string; rank: number; score: number; opportunityState: string | null; why: string[]; signalCodes: string[];
  company: { projectCompanyId: string; companyId: string; name: string; domain: string | null; website: string | null; industry: string | null; employeeCount: number | null; country: string | null };
  contact: { status: InstantLeadRunLead["contactStatus"]; credits: number; revealedAt: string | null; person: { name: string; title: string | null; email: string | null; emailStatus: string; linkedinUrl: string | null } | null };
};

export async function serializeLeads(run: InstantLeadRun): Promise<SerializedLead[]> {
  const rows = await db.select({ lead: instantLeadRunLeadsTable, company: companiesTable })
    .from(instantLeadRunLeadsTable).innerJoin(companiesTable, eq(companiesTable.id, instantLeadRunLeadsTable.companyId))
    .where(eq(instantLeadRunLeadsTable.runId, run.id)).orderBy(instantLeadRunLeadsTable.rank);
  const personIds = rows.map((row) => row.lead.contactPersonId).filter((id): id is string => Boolean(id));
  const people = personIds.length
    ? await db.select({ person: peopleTable, context: projectPersonContextTable })
      .from(peopleTable)
      .leftJoin(projectPersonContextTable, and(eq(projectPersonContextTable.personId, peopleTable.id), eq(projectPersonContextTable.projectId, run.projectId)))
      .where(inArray(peopleTable.id, personIds))
    : [];
  const byPerson = new Map<string, (typeof people)[number]>();
  for (const row of people) if (!byPerson.has(row.person.id) || row.context) byPerson.set(row.person.id, row);
  return rows.map(({ lead, company }) => {
    const found = lead.contactPersonId ? byPerson.get(lead.contactPersonId) : null;
    return {
      id: lead.id, rank: lead.rank, score: lead.score, opportunityState: lead.opportunityState, why: lead.why, signalCodes: lead.signalCodes,
      company: {
        projectCompanyId: lead.projectCompanyId, companyId: company.id, name: company.canonicalName, domain: company.domain, website: company.website,
        industry: company.industry, employeeCount: company.employeeCount, country: company.country,
      },
      contact: {
        status: lead.contactStatus, credits: lead.contactCredits, revealedAt: iso(lead.contactRevealedAt),
        person: found ? {
          name: found.person.canonicalName, title: found.person.defaultTitle, email: found.context?.email ?? null,
          emailStatus: found.context?.emailStatus ?? "UNKNOWN", linkedinUrl: found.person.profileUrl,
        } : null,
      },
    };
  });
}

export function serializeCreditRequest(row: typeof creditRequestsTable.$inferSelect) {
  return {
    id: row.id, credits: row.credits, reason: row.reason, status: row.status,
    createdAt: row.createdAt.toISOString(), resolvedAt: iso(row.resolvedAt),
  };
}

