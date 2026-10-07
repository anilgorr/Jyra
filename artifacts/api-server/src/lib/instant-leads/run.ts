import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  companiesTable,
  companyFactsTable,
  companyProvenanceTable,
  creditLedgerTable,
  db,
  icpCriteriaTable,
  instantLeadRunLeadsTable,
  instantLeadRunsTable,
  INSTANT_LEAD_RUN_WORKING_STATUSES,
  projectCompaniesTable,
  projectSignalPacksTable,
  projectsTable,
  signalDefinitionsTable,
  signalPacksTable,
  signalsTable,
  spendLedgerTable,
  dataProvidersTable,
  type InstantLeadFilterSnapshot,
  type InstantLeadRun,
  type InstantLeadRunStatus,
  type Project,
  type SignalPack,
} from "@workspace/db";
import { canonicalCompanyNameKey, normalizeCompanyInput } from "../company-identity";
import { withNormalizedColumns } from "../company-normalization";
import { buildDiscoveryPlan, classifyCandidateBuyerRole, qualifyCandidate } from "../company-discovery";
import { creditSummary, InsufficientCreditsError, postCreditEntry } from "../credits";
import { factLabel } from "../opportunity-headline";
import { resolveOrganizationPlan, screeningPoolCapacity, screeningPoolSize, watchPoolCapacity, type ResolvedPlan } from "../plans";
import { effectiveResearchBudgetLimits, getResearchBudget } from "../research-economics";
import { projectSpendSince, utcDayStart } from "../spend-ledger";
import { researchBlockers, resolveProjectSellerContext } from "../seller-context";
import { loadProjectCompany, runIntelligenceCycle, SellerContextIncompleteError, type CycleLogger } from "../intelligence-v2/run-cycle";
import type { IntelligenceV2Repository } from "../intelligence-v2/orchestrator";
import { classifyCycleFailure, watchLoopHalt } from "../intelligence-v2/watch-loop";
import { COMPANY_FIELDS, createCrustdataClient, crustdataConfiguration, crustdataFailureMessage, CrustdataError, type CrustdataClient, type CrustdataCompany } from "./crustdata-client";
import { buildInstantLeadFilters, describeFilterPlan, widenInstantLeadFilters, withoutField, type InstantLeadFilterPlan } from "./filters";
import { countryLabel } from "./geography";

/**
 * Instant Leads: the run.
 *
 * A customer asks for N accounts showing intent now. The run holds N × price
 * in credits, asks Crustdata for companies matching the ICP that recently
 * did something the pack cares about, screens them, researches them with
 * the ordinary intelligence cycle, keeps the ones whose intent JYRA's own
 * facts confirm, ranks them, delivers the top N with a plain-words "why",
 * and settles the hold for what it delivered. Everything undelivered is
 * released, never charged.
 *
 * It is a task, not a request: stages and counts are written to the run
 * row as they happen so the page can poll, and a process restart resumes
 * from the persisted candidate list. Research runs in batches and stops
 * as soon as enough leads are confirmed, so a 10-lead order on a hot market
 * costs ten or twenty cycles, not fifty.
 */

export const INSTANT_LEADS_ACTION = "instant_leads";
export const INSTANT_LEAD_FAILURE_CODES = {
  NO_ICP: "NO_ICP", NO_OFFERING: "NO_OFFERING", NO_PACK: "NO_PACK", RUN_ACTIVE: "RUN_ACTIVE", RESEARCH_HALTED: "RESEARCH_HALTED",
  INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS", PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED", RESEARCH_BUDGET: "RESEARCH_BUDGET",
  SCREENING_POOL_FULL: "SCREENING_POOL_FULL", BAD_REQUEST: "BAD_REQUEST",
} as const;

export type InstantLeadBlocker = { code: keyof typeof INSTANT_LEAD_FAILURE_CODES; message: string };

export type InstantLeadQuote = {
  requested: number;
  creditsPerLead: number;
  creditsRequired: number;
  balance: number;
  shortfall: number;
  /** How many leads the balance allows at this price. */
  affordable: number;
  contactPrices: { verified: number; catchAll: number };
  blockers: InstantLeadBlocker[];
  icp: { summary: string[]; unmapped: { industries: string[]; geographies: string[] }; criteriaCount: number; icpVersionId: string | null };
  pack: { id: string; name: string; version: string } | null;
  /** Minutes, for the page's "about N minutes" before a run starts. */
  estimatedMinutes: number;
};

export type InstantLeadRunDeps = {
  client: CrustdataClient;
  cycle: typeof runIntelligenceCycle;
  repository: IntelligenceV2Repository;
  log: CycleLogger;
  now: () => Date;
  /** Research cycles at once. Three on the API host; the watch loop runs beside it. */
  concurrency: number;
  /** Candidates fetched and researched per batch; ranking runs after each. */
  batchSize: number;
  /** Candidates asked for per lead requested. */
  candidatesPerLead: number;
  /** Hard cap on candidates touched by one run. */
  maxCandidates: number;
  /** Wall-clock cap; what is confirmed by then is delivered. */
  maxDurationMs: number;
  /** Average cycle length for the first ETA, refined as cycles finish. */
  assumedCycleMs: number;
};

/** What one research cycle costs on average, for the budget check before a run. Admin-facing only. */
export const ASSUMED_CYCLE_COST_USD = 0.013;
/** Consecutive cycle failures that stop a run; the watch loop's breaker uses the same figure. */
export const HALT_AFTER_CONSECUTIVE_FAILURES = 3;

export const DEFAULT_RUN_DEPS: Omit<InstantLeadRunDeps, "client" | "repository" | "log"> = {
  cycle: runIntelligenceCycle,
  now: () => new Date(),
  concurrency: 3,
  batchSize: 100,
  candidatesPerLead: 5,
  maxCandidates: 2_000,
  maxDurationMs: 45 * 60_000,
  assumedCycleMs: 46_000,
};

/* ------------------------------------------------------------------------ */
/* The provider, from its row                                                */
/* ------------------------------------------------------------------------ */

export async function crustdataClientFromCatalogue(env: NodeJS.ProcessEnv = process.env): Promise<CrustdataClient> {
  const [row] = await db.select().from(dataProvidersTable).where(eq(dataProvidersTable.providerType, "crustdata")).limit(1);
  return createCrustdataClient({ apiKey: env.CRUSTDATA_API_KEY, configuration: crustdataConfiguration(row?.configuration ?? null, env) });
}

/* ------------------------------------------------------------------------ */
/* Quote                                                                     */
/* ------------------------------------------------------------------------ */

type PackContext = { pack: SignalPack; definitions: Array<{ code: string; category: string; polarity: "POSITIVE" | "NEGATIVE"; factTypes: string[]; matchAny: string[]; lifetimeDays: number; description: string; name: string }> } | null;

async function activePack(projectId: string): Promise<PackContext> {
  const [selection] = await db.select().from(projectSignalPacksTable)
    .where(and(eq(projectSignalPacksTable.projectId, projectId), eq(projectSignalPacksTable.active, true)))
    .orderBy(desc(projectSignalPacksTable.updatedAt)).limit(1);
  if (!selection) return null;
  const [pack] = await db.select().from(signalPacksTable).where(and(eq(signalPacksTable.id, selection.signalPackId), eq(signalPacksTable.active, true))).limit(1);
  if (!pack || pack.status !== "APPROVED") return null;
  const disabled = new Set((selection.configuration as { disabledCodes?: string[] } | null)?.disabledCodes ?? []);
  const rows = await db.select().from(signalDefinitionsTable).where(eq(signalDefinitionsTable.signalPackId, pack.id));
  const definitions = rows.filter((row) => row.status === "APPROVED" && !disabled.has(row.code)).map((row) => {
    const configuration = (row.configuration ?? {}) as { factTypes?: string[]; matchAny?: string[] };
    const requirements = (row.factRequirements ?? {}) as { factTypes?: string[] };
    return {
      code: row.code, category: row.category, polarity: row.polarity, name: row.name, description: row.description,
      factTypes: configuration.factTypes ?? requirements.factTypes ?? [], matchAny: configuration.matchAny ?? [], lifetimeDays: row.lifetimeDays,
    };
  });
  return { pack, definitions };
}

async function acceptedCriteria(projectId: string, icpVersionId: string | null) {
  if (!icpVersionId) return [];
  return db.select().from(icpCriteriaTable).where(and(eq(icpCriteriaTable.projectId, projectId), eq(icpCriteriaTable.icpVersionId, icpVersionId), eq(icpCriteriaTable.accepted, true)));
}

export async function activeRunForProject(projectId: string): Promise<InstantLeadRun | null> {
  const [run] = await db.select().from(instantLeadRunsTable)
    .where(and(eq(instantLeadRunsTable.projectId, projectId), inArray(instantLeadRunsTable.status, [...INSTANT_LEAD_RUN_WORKING_STATUSES])))
    .orderBy(desc(instantLeadRunsTable.createdAt)).limit(1);
  return run ?? null;
}

/** The hold the plan would need for N candidates' research, against what the project may still spend today. */
async function researchBudgetAllows(projectId: string, candidates: number, now: Date): Promise<{ allowed: boolean; message: string | null }> {
  const limits = effectiveResearchBudgetLimits(await getResearchBudget(projectId));
  const spent = await projectSpendSince(projectId, utcDayStart(now));
  const estimate = candidates * ASSUMED_CYCLE_COST_USD;
  if (spent + estimate > limits.dailyBudget) {
    // No money figures here: this text reaches the customer. The admin cost page has the numbers.
    const affordable = Math.max(0, Math.floor((limits.dailyBudget - spent) / ASSUMED_CYCLE_COST_USD / DEFAULT_RUN_DEPS.candidatesPerLead));
    return { allowed: false, message: affordable > 0
      ? `This project's research allowance for today covers about ${affordable} lead${affordable === 1 ? "" : "s"}. Request fewer, or ask your JYRA contact to raise it.`
      : "This project's research allowance for today is used up. Ask your JYRA contact to raise it, or try again tomorrow." };
  }
  return { allowed: true, message: null };
}

export async function quoteInstantLeads(input: { project: Project; requested: number; now?: Date; deps?: Partial<InstantLeadRunDeps>; env?: NodeJS.ProcessEnv }): Promise<InstantLeadQuote> {
  const now = input.now ?? new Date();
  const requested = Math.max(1, Math.floor(input.requested));
  const deps = { ...DEFAULT_RUN_DEPS, ...input.deps };
  const [plan, credits, seller, pack, active] = await Promise.all([
    resolveOrganizationPlan(input.project.organizationId),
    creditSummary(input.project.organizationId),
    resolveProjectSellerContext(input.project.id, input.project.organizationId),
    activePack(input.project.id),
    activeRunForProject(input.project.id),
  ]);
  const blockers: InstantLeadBlocker[] = [];
  const research = researchBlockers(seller);
  if (!seller.offeringReady || research.some((code) => code.startsWith("BUSINESS_TWIN") || code.startsWith("OFFERING"))) {
    blockers.push({ code: "NO_OFFERING", message: "Your Business Twin does not describe what you sell yet." });
  }
  if (!seller.icpVersionId || research.some((code) => code.startsWith("ICP"))) {
    blockers.push({ code: "NO_ICP", message: "Your ICP is not ready - create or regenerate it first." });
  }
  if (!pack) blockers.push({ code: "NO_PACK", message: "No signal pack is active for this project. Your JYRA contact sets one up from your Business Twin and ICP." });
  if (active) blockers.push({ code: "RUN_ACTIVE", message: "A run is already in progress for this project; it will start when that one finishes." });
  const halt = watchLoopHalt();
  if (halt) blockers.push({ code: "RESEARCH_HALTED", message: "Research is stopped at the moment; try again shortly." });
  if (!(input.env ?? process.env).CRUSTDATA_API_KEY) blockers.push({ code: "PROVIDER_NOT_CONFIGURED", message: "The company data provider is not set up yet." });

  const creditsPerLead = plan.creditsPerInstantLead;
  const creditsRequired = requested * creditsPerLead;
  const shortfall = Math.max(0, creditsRequired - credits.balance);
  if (shortfall > 0) blockers.push({ code: "INSUFFICIENT_CREDITS", message: `${requested} leads needs ${creditsRequired.toLocaleString("en-IN")} credits; you have ${credits.balance.toLocaleString("en-IN")}.` });

  const candidates = Math.min(deps.maxCandidates, requested * deps.candidatesPerLead);
  const budget = await researchBudgetAllows(input.project.id, candidates, now);
  if (!budget.allowed) blockers.push({ code: "RESEARCH_BUDGET", message: budget.message! });
  const screening = await screeningPoolCapacity(input.project.organizationId);
  if (screening.remaining < Math.min(candidates, deps.batchSize)) {
    blockers.push({ code: "SCREENING_POOL_FULL", message: `Your plan's screening pool is full (${screening.used} of ${screeningPoolSize(screening.plan)}). Archive companies you no longer need, or ask your JYRA contact for room.` });
  }

  const criteria = await acceptedCriteria(input.project.id, seller.icpVersionId);
  const filterPlan = buildInstantLeadFilters({
    criteria: criteria.map((row) => ({ dimension: row.dimension, operator: row.operator, value: row.value, accepted: row.accepted })),
    definitions: pack?.definitions ?? [], now,
  });
  // Pessimistic: every candidate researched, none confirmed early.
  const estimatedMinutes = Math.max(3, Math.ceil((60_000 + (candidates * deps.assumedCycleMs) / deps.concurrency) / 60_000));
  return {
    requested, creditsPerLead, creditsRequired, balance: credits.balance, shortfall,
    affordable: Math.floor(credits.balance / Math.max(1, creditsPerLead)),
    contactPrices: { verified: plan.creditsPerContactVerified, catchAll: plan.creditsPerContactCatchAll },
    blockers,
    icp: { summary: describeFilterPlan(filterPlan, { country: countryLabel }), unmapped: filterPlan.unmapped, criteriaCount: criteria.length, icpVersionId: seller.icpVersionId },
    pack: pack ? { id: pack.pack.id, name: pack.pack.name, version: pack.pack.version } : null,
    estimatedMinutes,
  };
}

/* ------------------------------------------------------------------------ */
/* Create: hold the credits, write the run                                   */
/* ------------------------------------------------------------------------ */

export class InstantLeadRequestError extends Error {
  constructor(public readonly code: keyof typeof INSTANT_LEAD_FAILURE_CODES, message: string, public readonly status: 400 | 402 | 409 | 503 = 409) {
    super(message); this.name = "InstantLeadRequestError";
  }
}

export async function createInstantLeadRun(input: { project: Project; userId: string; requested: number; now?: Date; deps?: Partial<InstantLeadRunDeps>; env?: NodeJS.ProcessEnv }): Promise<{ run: InstantLeadRun; quote: InstantLeadQuote }> {
  const now = input.now ?? new Date();
  const requested = Math.floor(input.requested);
  if (!Number.isInteger(requested) || requested < 1) throw new InstantLeadRequestError("BAD_REQUEST", "Ask for at least one lead", 400);
  const quote = await quoteInstantLeads({ ...input, requested, now });
  // A queued run behind an active one is allowed; everything else blocks.
  const blocking = quote.blockers.filter((blocker) => blocker.code !== "RUN_ACTIVE");
  if (blocking.length) {
    const first = blocking[0]!;
    throw new InstantLeadRequestError(first.code, first.message, first.code === "INSUFFICIENT_CREDITS" ? 402 : first.code === "PROVIDER_NOT_CONFIGURED" || first.code === "RESEARCH_HALTED" ? 503 : 409);
  }
  const seller = await resolveProjectSellerContext(input.project.id, input.project.organizationId);
  const pack = await activePack(input.project.id);
  const run = await db.transaction(async (tx) => {
    // One hold per project at a time is decided under a lock, not by a race.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`instant-leads:${input.project.id}`}))`);
    const [created] = await tx.insert(instantLeadRunsTable).values({
      organizationId: input.project.organizationId, projectId: input.project.id, requestedByUserId: input.userId,
      requested, status: "QUEUED", creditsPerLead: quote.creditsPerLead, creditsHeld: quote.creditsRequired,
      icpVersionId: seller.icpVersionId, businessTwinVersionId: seller.businessTwinVersionId,
      signalPackId: pack?.pack.id ?? null, signalPackVersion: pack?.pack.version ?? null,
    }).returning();
    if (!created) throw new Error("run insert returned nothing");
    let hold;
    try {
      hold = await postCreditEntry({
        organizationId: input.project.organizationId, kind: "debit", delta: -quote.creditsRequired,
        description: `Instant Leads: hold for ${requested} lead${requested === 1 ? "" : "s"} at ${quote.creditsPerLead} each`,
        context: { action: INSTANT_LEADS_ACTION, stage: "hold", runId: created.id, projectId: input.project.id, requested, creditsPerLead: quote.creditsPerLead },
        createdByUserId: input.userId,
      }, tx);
    } catch (error) {
      if (error instanceof InsufficientCreditsError) throw new InstantLeadRequestError("INSUFFICIENT_CREDITS", `${requested} leads needs ${quote.creditsRequired} credits; you have ${error.balance}.`, 402);
      throw error;
    }
    const [updated] = await tx.update(instantLeadRunsTable).set({ holdEntryId: hold.entryId, updatedAt: now }).where(eq(instantLeadRunsTable.id, created.id)).returning();
    return updated ?? created;
  });
  return { run, quote };
}

/* ------------------------------------------------------------------------ */
/* Execute                                                                   */
/* ------------------------------------------------------------------------ */

type RunPatch = Partial<Pick<InstantLeadRun,
  "status" | "candidatesFound" | "candidatesAccepted" | "researched" | "confirmed" | "delivered" | "etaSeconds" | "filters" | "widened"
  | "pendingProjectCompanyIds" | "touchedProjectCompanyIds" | "providerCalls" | "providerCostUsd" | "researchCostUsd" | "errorCode" | "errorMessage"
  | "outcomeNote" | "startedAt" | "finishedAt" | "creditsSettled" | "settleEntryId">>;

async function patchRun(runId: string, patch: RunPatch, now: Date): Promise<InstantLeadRun> {
  const [row] = await db.update(instantLeadRunsTable).set({ ...patch, updatedAt: now }).where(eq(instantLeadRunsTable.id, runId)).returning();
  if (!row) throw new Error(`run ${runId} vanished`);
  return row;
}

/** Thrown inside the executor when the row was cancelled from outside; the catch path delivers what is confirmed. */
export class InstantLeadRunCancelled extends Error {
  constructor() { super("cancelled"); this.name = "InstantLeadRunCancelled"; }
}

/**
 * The executor's own patch: it only lands while the run is still working.
 * A cancel flips the status from outside; the next checkpoint here sees
 * zero rows updated and stops the run instead of writing over the cancel.
 */
async function checkpoint(runId: string, patch: RunPatch, now: Date): Promise<InstantLeadRun> {
  const [row] = await db.update(instantLeadRunsTable).set({ ...patch, updatedAt: now })
    .where(and(eq(instantLeadRunsTable.id, runId), inArray(instantLeadRunsTable.status, [...INSTANT_LEAD_RUN_WORKING_STATUSES])))
    .returning();
  if (!row) throw new InstantLeadRunCancelled();
  return row;
}

const normalizeDomain = (domain: string | null | undefined): string | null => domain ? domain.toLowerCase().replace(/^www\./, "") : null;

/**
 * Domains the search must not deliver again: companies on this project's
 * board (anything past screening), and companies an earlier run delivered.
 * A company that was only screened and never delivered may come back: the
 * market moved on since, and nobody paid for it.
 */
async function excludedDomains(projectId: string): Promise<Set<string>> {
  const rows = await db.select({ domain: companiesTable.domain, status: projectCompaniesTable.status, projectCompanyId: projectCompaniesTable.id })
    .from(projectCompaniesTable).innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .where(eq(projectCompaniesTable.projectId, projectId));
  const delivered = new Set((await db.select({ projectCompanyId: instantLeadRunLeadsTable.projectCompanyId })
    .from(instantLeadRunLeadsTable).where(eq(instantLeadRunLeadsTable.projectId, projectId))).map((row) => row.projectCompanyId));
  const out = new Set<string>();
  for (const row of rows) {
    const domain = normalizeDomain(row.domain);
    if (domain && (row.status !== "screening" || delivered.has(row.projectCompanyId))) out.add(domain);
  }
  return out;
}

type LinkedCandidate = { projectCompanyId: string; companyId: string; domain: string };

/**
 * A Crustdata row becomes a company and a screening-status membership of
 * the project, unless the ICP screen says it is not a buyer. Screening is
 * free and unwatched: the run pays for research, and only a delivered lead
 * is promoted into the watch pool.
 */
async function linkCandidates(input: {
  run: InstantLeadRun; companies: CrustdataCompany[]; strategy: Awaited<ReturnType<typeof buildDiscoveryPlan>>["strategy"];
  /** What the provider already filtered on: a check that fails only on these is the vocabulary disagreeing, not the company. */
  searched: { countries: Set<string>; industries: Set<string>; headcount: { min: number | null; max: number | null } };
  sellerIndustry: string | null; offeringLabel: string; targetIndustries: string[]; now: Date; log: CycleLogger;
}): Promise<{ linked: LinkedCandidate[]; rejected: number }> {
  const linked: LinkedCandidate[] = [];
  let rejected = 0;
  const within = (value: number | null, range: { min: number | null; max: number | null }) => value !== null && (range.min === null || value >= range.min) && (range.max === null || value <= range.max);
  for (const company of input.companies) {
    if (!company.domain || !company.name) { rejected += 1; continue; }
    const normalized = normalizeCompanyInput({
      canonicalName: company.name, domain: company.domain, website: company.website ?? `https://${company.domain}`,
      country: company.country ? countryLabel(company.country) : null, industry: company.industries[0] ?? null,
      employeeCount: company.headcount, description: null,
    });
    if (!normalized.value) { rejected += 1; continue; }
    const buyerRole = classifyCandidateBuyerRole({
      name: company.name, industry: company.industries[0] ?? null, description: null,
      offeringLabel: input.offeringLabel, sellerIndustry: input.sellerIndustry, targetIndustries: input.targetIndustries,
    });
    const assessment = qualifyCandidate(normalized.value, input.strategy, null, null, buyerRole);
    // The ICP screen speaks the customer's words ("Middle East", "Fintech"); the provider spoke ISO codes and
    // LinkedIn industries. A check that fails only where the search already filtered is forgiven.
    const satisfiedBySearch: Record<string, boolean> = {
      geography: Boolean(company.country && input.searched.countries.has(company.country.toLowerCase())),
      // Industries are not in the free response; a company the industry filter returned satisfied it by definition.
      industry: company.industries.length === 0 ? input.searched.industries.size > 0 : company.industries.some((industry) => input.searched.industries.has(industry.toLowerCase())),
      employeeRange: within(company.headcount, input.searched.headcount),
    };
    const failing = Object.entries(assessment.checks).filter(([, value]) => value === false).map(([key]) => key);
    const forgiven = failing.length > 0 && failing.every((key) => satisfiedBySearch[key]);
    if ((assessment.classification === "LIKELY_NOT_FIT" && !forgiven) || assessment.buyerRole === "SELLER_COMPETITOR") { rejected += 1; continue; }
    const value = normalized.value;
    try {
      const row = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${value.domain ?? `company-name:${canonicalCompanyNameKey(value.canonicalName)}`}))`);
        const [existing] = value.domain ? await tx.select().from(companiesTable).where(eq(companiesTable.domain, value.domain)).limit(1) : [];
        const companyRow = existing ?? (await tx.insert(companiesTable).values(withNormalizedColumns({
          canonicalName: value.canonicalName, domain: value.domain, website: value.website, linkedinUrl: value.linkedinUrl, profileUrls: value.profileUrls,
          country: value.country, industry: value.industry, employeeCount: value.employeeCount, employeeRange: value.employeeRange, description: value.description,
        })).returning())[0];
        if (!companyRow) return null;
        const [inserted] = await tx.insert(projectCompaniesTable)
          .values({ projectId: input.run.projectId, companyId: companyRow.id, status: "screening", buyerRole: assessment.buyerRole, buyerRoleAssessment: assessment.buyerRoleAssessment })
          .onConflictDoNothing({ target: [projectCompaniesTable.projectId, projectCompaniesTable.companyId] })
          .returning();
        let membership = inserted ?? null;
        if (!membership) {
          // Already linked. Only a screened-and-never-delivered company is researched again; the board is never delivered twice.
          const [existingMembership] = await tx.select().from(projectCompaniesTable)
            .where(and(eq(projectCompaniesTable.projectId, input.run.projectId), eq(projectCompaniesTable.companyId, companyRow.id))).limit(1);
          if (!existingMembership || existingMembership.status !== "screening") return null;
          const [deliveredBefore] = await tx.select({ id: instantLeadRunLeadsTable.id }).from(instantLeadRunLeadsTable)
            .where(eq(instantLeadRunLeadsTable.projectCompanyId, existingMembership.id)).limit(1);
          if (deliveredBefore) return null;
          membership = existingMembership;
        }
        await tx.insert(companyProvenanceTable).values({
          organizationId: input.run.organizationId, projectId: input.run.projectId, companyId: companyRow.id,
          sourceType: "JYRA_DISCOVERY", sourceLabel: "crustdata:instant-leads", sourceUrl: company.website ?? `https://${company.domain}`, observedAt: input.now,
          payload: {
            provider: "crustdata", capability: "COMPANY_DISCOVERY", instantLeadRunId: input.run.id,
            headcount: company.headcount, headcountGrowth6m: company.headcountGrowth6m, headcountGrowth3m: company.headcountGrowth3m,
            country: company.country, city: company.city, industries: company.industries,
            lastFundraiseDate: company.lastFundraiseDate, lastRoundType: company.lastRoundType, totalInvestmentUsd: company.totalInvestmentUsd,
          },
        });
        return { projectCompanyId: membership.id, companyId: companyRow.id, domain: company.domain! };
      });
      if (row) linked.push(row); else rejected += 1;
    } catch (error) {
      rejected += 1;
      input.log.warn({ runId: input.run.id, domain: company.domain, err: error }, "INSTANT_LEADS_LINK_FAILED");
    }
  }
  return { linked, rejected };
}

type RankedLead = { projectCompanyId: string; companyId: string; score: number; opportunityState: string | null; why: string[]; signalCodes: string[] };

/**
 * Which researched candidates earned a place, in what order, and why.
 *
 * Eligible means JYRA's own research confirmed intent: at least one ACTIVE
 * positive signal from the run's pack, and a buyer role that is not a
 * competitor or vendor. Crustdata's search flag alone is never enough.
 * Ordered by opportunity score; the "why" is the signals' facts in plain
 * words with the pack's own reason, plus one line of fit.
 */
export async function rankCandidates(input: { run: InstantLeadRun; projectCompanyIds: string[]; limit: number; now: Date }): Promise<RankedLead[]> {
  if (!input.projectCompanyIds.length) return [];
  const rows = await db.select({ projectCompany: projectCompaniesTable, company: companiesTable })
    .from(projectCompaniesTable).innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .where(inArray(projectCompaniesTable.id, input.projectCompanyIds));
  const companyIds = rows.map((row) => row.company.id);
  if (!companyIds.length) return [];
  const signals = await db.select({
    companyId: signalsTable.companyId, strength: signalsTable.currentStrength, effectiveDate: signalsTable.effectiveDate, factIds: signalsTable.supportingFactIds,
    code: signalDefinitionsTable.code, name: signalDefinitionsTable.name, description: signalDefinitionsTable.description,
    polarity: signalDefinitionsTable.polarity, packId: signalDefinitionsTable.signalPackId,
  }).from(signalsTable).innerJoin(signalDefinitionsTable, eq(signalDefinitionsTable.id, signalsTable.signalDefinitionId))
    .where(and(eq(signalsTable.projectId, input.run.projectId), inArray(signalsTable.companyId, companyIds), eq(signalsTable.status, "ACTIVE")));
  const factIds = [...new Set(signals.flatMap((signal) => signal.factIds ?? []))];
  const facts = factIds.length
    ? await db.select({ id: companyFactsTable.id, factType: companyFactsTable.factType, structuredValue: companyFactsTable.structuredValue, supportingExcerpt: companyFactsTable.supportingExcerpt, effectiveDate: companyFactsTable.effectiveDate })
      .from(companyFactsTable).where(inArray(companyFactsTable.id, factIds))
    : [];
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));

  const ranked: RankedLead[] = [];
  for (const { projectCompany, company } of rows) {
    if (["SELLER_COMPETITOR", "ADJACENT_VENDOR"].includes(projectCompany.buyerRole)) continue;
    const own = signals.filter((signal) => signal.companyId === company.id && (!input.run.signalPackId || signal.packId === input.run.signalPackId));
    const positive = own.filter((signal) => signal.polarity === "POSITIVE").sort((left, right) => right.strength - left.strength);
    if (!positive.length) continue;
    const why = whyBullets({
      signals: positive.map((signal) => ({ name: signal.name, description: signal.description, effectiveDate: signal.effectiveDate, facts: (signal.factIds ?? []).map((id) => factsById.get(id)).filter((f): f is NonNullable<typeof f> => Boolean(f)) })),
      negatives: own.filter((signal) => signal.polarity === "NEGATIVE").map((signal) => signal.name),
      company: { industry: company.industry, employeeCount: company.employeeCount, country: company.country, city: null },
      now: input.now,
    });
    ranked.push({
      projectCompanyId: projectCompany.id, companyId: company.id,
      score: projectCompany.opportunityScore ?? 0, opportunityState: projectCompany.opportunityState ?? null,
      why, signalCodes: positive.map((signal) => signal.code),
    });
  }
  return ranked.sort((left, right) => right.score - left.score).slice(0, input.limit);
}

const shortDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/** Pure: the card's bullets. No URLs, no confidences; the company page has the evidence. */
export function whyBullets(input: {
  signals: Array<{ name: string; description: string; effectiveDate: string | null; facts: Array<{ factType: string; structuredValue: unknown; supportingExcerpt: string; effectiveDate: string | null }> }>;
  negatives: string[];
  company: { industry: string | null; employeeCount: number | null; country: string | null; city: string | null };
  now: Date;
}): string[] {
  const bullets: string[] = [];
  const seen = new Set<string>();
  for (const signal of input.signals.slice(0, 4)) {
    const facts = [...signal.facts].sort((left, right) => (right.effectiveDate ?? "").localeCompare(left.effectiveDate ?? ""));
    const lead = facts[0];
    const what = lead ? factLabel(lead) : signal.name;
    const when = shortDate(lead?.effectiveDate ?? signal.effectiveDate);
    const count = facts.length > 1 ? ` (${facts.length} in all)` : "";
    const reason = signal.description && !/interpreted for this offering\.?$/i.test(signal.description.trim()) ? ` — ${signal.description.trim().replace(/\.$/, "")}` : ` — ${signal.name}`;
    const line = `${what}${when ? `, ${when}` : ""}${count}${reason}`;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(line);
  }
  const fit: string[] = [];
  if (input.company.industry) fit.push(input.company.industry);
  if (input.company.employeeCount) fit.push(`${input.company.employeeCount.toLocaleString("en-IN")} staff`);
  if (input.company.city) fit.push(input.company.city);
  else if (input.company.country) fit.push(input.company.country);
  if (fit.length) bullets.push(`Fits your ICP: ${fit.join(", ")}`);
  if (input.negatives.length) bullets.push(`Worth knowing: ${input.negatives.join("; ")}`);
  return bullets.slice(0, 6);
}

/** Settle the hold for what was delivered; release the rest. Idempotent: a second call finds the settle entry and returns. */
async function settleCredits(run: InstantLeadRun, delivered: number, now: Date, note: string): Promise<{ settled: number; released: number; entryId: string | null }> {
  if (run.settleEntryId) return { settled: run.creditsSettled, released: run.creditsHeld - run.creditsSettled, entryId: run.settleEntryId };
  const settled = Math.min(run.creditsHeld, delivered * run.creditsPerLead);
  const released = run.creditsHeld - settled;
  let entryId: string | null = null;
  if (released > 0) {
    const entry = await postCreditEntry({
      organizationId: run.organizationId, kind: "adjustment", delta: released,
      description: `Instant Leads: released ${released} credits — ${note}`,
      context: { action: INSTANT_LEADS_ACTION, stage: "release", runId: run.id, projectId: run.projectId, reverses: run.holdEntryId, delivered, requested: run.requested },
    });
    entryId = entry.entryId;
  }
  await patchRun(run.id, { creditsSettled: settled, settleEntryId: entryId ?? run.holdEntryId ?? null }, now);
  return { settled, released, entryId };
}

/** Research spend attributed to the run: ledger rows for the companies it touched, since it started. */
async function researchCostSince(run: InstantLeadRun, projectCompanyIds: string[], since: Date): Promise<number> {
  if (!projectCompanyIds.length) return 0;
  const [row] = await db.select({ total: sql<number>`coalesce(sum(${spendLedgerTable.costUsd}), 0)::float` })
    .from(spendLedgerTable)
    .where(and(inArray(spendLedgerTable.projectCompanyId, projectCompanyIds), sql`${spendLedgerTable.occurredAt} >= ${since}`));
  return Number(row?.total ?? 0);
}

/** Run `tasks` with at most `limit` in flight; errors are handed to `onError` and never stop the rest. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>, shouldStop: () => boolean): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < items.length && !shouldStop()) {
      const item = items[index++]!;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/** The whole run, resumable: every stage reads the row and writes it back. */
export async function executeInstantLeadRun(runId: string, input: InstantLeadRunDeps): Promise<InstantLeadRun> {
  const startedAt = input.now();
  let run = (await db.select().from(instantLeadRunsTable).where(eq(instantLeadRunsTable.id, runId)).limit(1))[0];
  if (!run) throw new Error(`instant lead run ${runId} not found`);
  if (!(INSTANT_LEAD_RUN_WORKING_STATUSES as readonly string[]).includes(run.status)) return run;
  const log = input.log;

  const touched = new Set<string>(run.touchedProjectCompanyIds ?? []);
  const pending: string[] = [...(run.pendingProjectCompanyIds ?? [])];
  let providerCalls = run.providerCalls;
  let providerCostUsd = run.providerCostUsd;
  let researched = run.researched;
  let cycleMsTotal = 0;
  let cycleCount = 0;
  let cycleFailures = 0;
  let cancelled = false;
  const elapsed = () => input.now().getTime() - (run!.startedAt ?? startedAt).getTime();
  const outOfTime = () => elapsed() > input.maxDurationMs;

  /** Whatever was confirmed before a stop is still delivered and still paid for; the rest of the hold is released. */
  async function stop(current: InstantLeadRun, status: "FAILED" | "CANCELLED", code: string | null, message: string, now: Date, detail: string = message): Promise<InstantLeadRun> {
    log.warn({ runId: current.id, status, code, message, detail: detail.slice(0, 600) }, status === "FAILED" ? "INSTANT_LEADS_RUN_FAILED" : "INSTANT_LEADS_RUN_CANCELLED");
    const ranked = await rankCandidates({ run: current, projectCompanyIds: [...touched], limit: current.requested, now }).catch(() => [] as RankedLead[]);
    const delivered = await writeLeads(current, ranked, now);
    const settled = await settleCredits(current, delivered, now, delivered ? `${delivered} delivered before the run stopped` : "the run stopped before delivering anything");
    const researchCostUsd = await researchCostSince(current, [...touched], current.startedAt ?? startedAt).catch(() => current.researchCostUsd);
    const stopped = status === "CANCELLED" ? "You cancelled the run" : `The run stopped early (${message})`;
    return patchRun(current.id, {
      // errorMessage is the provider's own words, for the admin page; the customer reads outcomeNote.
      status, errorCode: code, errorMessage: detail.slice(0, 1000), finishedAt: now, delivered, confirmed: delivered, etaSeconds: 0,
      researched, providerCalls, providerCostUsd, researchCostUsd, pendingProjectCompanyIds: [], touchedProjectCompanyIds: [...touched],
      outcomeNote: delivered
        ? `${stopped}. ${delivered} lead${delivered === 1 ? "" : "s"} confirmed before that ${delivered === 1 ? "is" : "are"} shown; ${settled.settled} credits charged, ${settled.released} released.`
        : status === "CANCELLED" ? `Cancelled before any lead was confirmed. All ${settled.released} credits were released.`
        : `The run could not complete: ${message}. All ${settled.released} credits were released.`,
    }, now);
  }
  const fail = (current: InstantLeadRun, code: string, message: string, now: Date, detail?: string) => stop(current, "FAILED", code, message, now, detail);

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, run.projectId)).limit(1);
  if (!project) return fail(run, "BAD_REQUEST", "Project not found", input.now());

  try {
    // ---- SEARCHING ----------------------------------------------------
    const now0 = input.now();
    if (run.status === "QUEUED" || !run.startedAt) run = await checkpoint(run.id, { status: "SEARCHING", startedAt: now0 }, now0);

    const seller = await resolveProjectSellerContext(project.id, project.organizationId);
    const blockers = researchBlockers(seller);
    if (blockers.length) return fail(run, "NO_ICP", `The project's setup is incomplete (${blockers.join(", ")})`, input.now());
    const packContext = await activePack(project.id);
    if (!packContext) return fail(run, "NO_PACK", "No signal pack is active for this project", input.now());
    const criteria = await acceptedCriteria(project.id, run.icpVersionId ?? seller.icpVersionId);
    let plan: InstantLeadFilterPlan = buildInstantLeadFilters({
      criteria: criteria.map((row) => ({ dimension: row.dimension, operator: row.operator, value: row.value, accepted: row.accepted })),
      definitions: packContext.definitions, now: now0,
    });
    const discoveryPlan = await buildDiscoveryPlan(project.id, seller);
    const exclude = await excludedDomains(project.id);
    const targetCandidates = Math.min(input.maxCandidates, run.requested * input.candidatesPerLead);
    const scope = { organizationId: run.organizationId, projectId: run.projectId, metadata: { instantLeadRunId: run.id } };

    // Pages of candidates; each page is screened, linked, researched and ranked before the next is fetched,
    // so a hot market stops early and a cold one keeps looking until the cap.
    let cursor: string | null = (run.filters as { cursor?: string | null } | null)?.cursor ?? null;
    let widened = run.widened;
    let searchedAnything = run.candidatesFound > 0;
    let confirmed = run.confirmed;
    let exhausted = false;
    let candidatesFound = run.candidatesFound;
    let candidatesAccepted = run.candidatesAccepted;

    let fields = [...COMPANY_FIELDS];
    const fetchPage = async (): Promise<CrustdataCompany[]> => {
      const pageSize = Math.min(input.batchSize, Math.max(10, targetCandidates - candidatesFound));
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const page = await input.client.searchCompanies({ filters: plan.filters, limit: pageSize, sorts: plan.sorts, fields, cursor }, scope);
          providerCalls += 1; providerCostUsd += page.costUsd;
          cursor = page.nextCursor;
          return page.items;
        } catch (error) {
          // A field the provider refuses - in the filters or in the fields asked for - is dropped and the search
          // retried; anything else is the run's failure.
          if (error instanceof CrustdataError && error.code === "CRUSTDATA_BAD_REQUEST") {
            // "Invalid fields: basic_info.industries. Did you mean 'basic_info.name'?" - the refused one is named first;
            // the suggestions after it must not be mistaken for it.
            const explicit = /invalid (?:fields?|filters?)[^:]*:\s*([a-z0-9_.]+?)\.?(?:[\s,'"]|$)/i.exec(error.message)?.[1] ?? null;
            const named = (field: string) => Boolean(field) && (field === explicit || (!explicit && new RegExp(`(^|[^a-z0-9_.])${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_]|\.[a-z0-9_])`, "i").test(error.message)));
            const refusedField = fields.find(named);
            const refusedFilter = plan.activity.map((item) => item.field).concat(plan.firmographic.map((item) => ("field" in item ? item.field : ""))).find(named);
            if (refusedField || refusedFilter) {
              log.warn({ runId: run!.id, field: refusedField ?? refusedFilter, detail: error.message.slice(0, 300) }, "INSTANT_LEADS_FIELD_REFUSED");
              if (refusedField) fields = fields.filter((field) => field !== refusedField);
              if (refusedFilter) plan = withoutField(plan, refusedFilter);
              continue;
            }
          }
          throw error;
        }
      }
      throw new CrustdataError("CRUSTDATA_BAD_REQUEST", "the search kept being refused", false);
    };

    const snapshot = (): InstantLeadFilterSnapshot => ({
      provider: "crustdata", filters: plan.filters, unmapped: plan.unmapped,
      activity: plan.activity.map(({ code, field, type, value }) => ({ code, field, type, value })), cursor,
    });
    const freshOnly = (companies: CrustdataCompany[]): CrustdataCompany[] => {
      const seen = new Set<string>();
      return companies.filter((company) => {
        const domain = normalizeDomain(company.domain);
        if (!domain || exclude.has(domain) || seen.has(domain)) return false;
        seen.add(domain);
        return true;
      });
    };

    const moreToSearch = () => !exhausted && candidatesFound < targetCandidates;
    while ((pending.length > 0 || moreToSearch()) && confirmed < run.requested && !outOfTime()) {
      if (!pending.length) {
        run = await checkpoint(run.id, { status: "SEARCHING", filters: snapshot(), widened }, input.now());
        const raw = await fetchPage();
        let page = freshOnly(raw);
        // Short on the first look: widen once, then carry on with whatever the market has.
        if (!searchedAnything && !widened && !cursor && page.length < 2 * Math.min(run.requested, input.batchSize)) {
          widened = true;
          plan = widenInstantLeadFilters(plan);
          cursor = null;
          page.forEach((company) => exclude.add(normalizeDomain(company.domain)!));
          page = [...page, ...freshOnly(await fetchPage())];
        }
        searchedAnything = true;
        candidatesFound += page.length;
        if (!cursor || !raw.length) exhausted = true;
        page.forEach((company) => exclude.add(normalizeDomain(company.domain)!));

        // ---- SCREENING ----------------------------------------------
        run = await checkpoint(run.id, { status: "SCREENING", candidatesFound, providerCalls, providerCostUsd, filters: snapshot(), widened }, input.now());
        const { linked } = await linkCandidates({
          run, companies: page, strategy: discoveryPlan.strategy,
          // Crustdata filters on ISO-3 but returns the normalised full name, so both spellings count as "searched".
          searched: { countries: new Set(plan.resolved.countries.flatMap((iso3) => [iso3, countryLabel(iso3)]).map((value) => value.toLowerCase())), industries: new Set(plan.resolved.industries.map((value) => value.toLowerCase())), headcount: plan.resolved.headcount },
          sellerIndustry: (seller.businessTwinRawAnswers as Record<string, unknown> | null)?.industry as string | null ?? null,
          offeringLabel: seller.context.offeringName ?? "", targetIndustries: discoveryPlan.strategy.targetIndustries ?? [],
          now: input.now(), log,
        });
        for (const candidate of linked) { touched.add(candidate.projectCompanyId); pending.push(candidate.projectCompanyId); }
        candidatesAccepted += linked.length;
      }

      // ---- RESEARCHING --------------------------------------------
      run = await checkpoint(run.id, {
        status: "RESEARCHING", candidatesAccepted, pendingProjectCompanyIds: [...pending], touchedProjectCompanyIds: [...touched],
        etaSeconds: Math.round((pending.length * (cycleCount ? cycleMsTotal / cycleCount : input.assumedCycleMs)) / input.concurrency / 1000) + 30,
      }, input.now());
      const batch = pending.splice(0, pending.length);
      let halted: string | null = null;
      let done = 0;
      let consecutiveFailures = 0;
      await pool(batch, input.concurrency, async (projectCompanyId) => {
        const owned = await loadProjectCompany(project.id, projectCompanyId);
        if (!owned) { done += 1; return; }
        const cycleStarted = input.now();
        try {
          await input.cycle({ owned, repository: input.repository, trigger: "MANUAL", actorId: run!.requestedByUserId, now: cycleStarted, log });
          consecutiveFailures = 0;
        } catch (error) {
          if (error instanceof SellerContextIncompleteError) { halted = halted ?? `the project's setup changed mid-run (${error.message})`; return; }
          const failure = classifyCycleFailure(error);
          if (failure.kind === "MODEL_UNAVAILABLE") { halted = halted ?? "the analysis model is refusing requests"; return; }
          log.warn({ runId: run!.id, projectCompanyId, err: error }, "INSTANT_LEADS_CYCLE_FAILED");
          cycleFailures += 1;
          consecutiveFailures += 1;
          // The same rule as the watch loop's breaker: three in a row is a broken pipeline, not three unlucky companies.
          if (consecutiveFailures >= HALT_AFTER_CONSECUTIVE_FAILURES) halted = halted ?? "research is failing repeatedly";
        } finally {
          researched += 1; cycleCount += 1; done += 1; cycleMsTotal += input.now().getTime() - cycleStarted.getTime();
          const remaining = Math.max(0, batch.length - done);
          // Progress for the page; a cancel from outside shows up here as zero rows updated.
          await checkpoint(run!.id, { researched, etaSeconds: Math.round((remaining * (cycleMsTotal / Math.max(1, cycleCount))) / input.concurrency / 1000) }, input.now())
            .catch((error) => { if (error instanceof InstantLeadRunCancelled) cancelled = true; });
        }
      }, () => halted !== null || cancelled || outOfTime());
      // Cycles that never started are still owed research; keep them for a resume or a later run.
      pending.push(...batch.slice(done));
      if (cancelled) throw new InstantLeadRunCancelled();
      if (halted) return fail(run, "RESEARCH_HALTED", halted, input.now());

      // ---- RANKING (per batch) -------------------------------------
      run = await checkpoint(run.id, { status: "RANKING", pendingProjectCompanyIds: [...pending], researched }, input.now());
      const ranked = await rankCandidates({ run, projectCompanyIds: [...touched], limit: run.requested, now: input.now() });
      confirmed = ranked.length;
      run = await checkpoint(run.id, { confirmed }, input.now());
      if (outOfTime()) break;
    }

    // ---- DELIVER ------------------------------------------------------
    const now1 = input.now();
    const ranked = await rankCandidates({ run, projectCompanyIds: [...touched], limit: run.requested, now: now1 });
    const delivered = await writeLeads(run, ranked, now1);
    const researchCostUsd = await researchCostSince(run, [...touched], run.startedAt ?? startedAt);
    const complete = delivered >= run.requested;
    const reason = complete ? ""
      : outOfTime() ? "the run reached its time limit"
      : cycleFailures > 0 && cycleFailures * 2 >= researched ? `research failed for ${cycleFailures} of ${researched} candidates; try again shortly`
      : exhausted ? `your market had ${delivered} compan${delivered === 1 ? "y" : "ies"} showing intent this week`
      : `${delivered} compan${delivered === 1 ? "y" : "ies"} showed confirmed intent within the search limit`;
    const settled = await settleCredits(run, delivered, now1, complete ? `${delivered} delivered` : reason);
    return checkpoint(run.id, {
      status: complete ? "DONE" : "PARTIAL", delivered, confirmed: delivered, finishedAt: now1, etaSeconds: 0,
      researched, candidatesFound, candidatesAccepted, providerCalls, providerCostUsd, researchCostUsd, widened,
      pendingProjectCompanyIds: [...pending], touchedProjectCompanyIds: [...touched],
      outcomeNote: complete
        ? `${delivered} lead${delivered === 1 ? "" : "s"} delivered; ${settled.settled} credits charged.`
        : `${delivered} of ${run.requested} leads delivered — ${reason}. ${settled.settled} credits charged, ${settled.released} released.`,
    }, now1);
  } catch (error) {
    const now = input.now();
    if (error instanceof InstantLeadRunCancelled) {
      const [current] = await db.select().from(instantLeadRunsTable).where(eq(instantLeadRunsTable.id, run.id)).limit(1);
      return stop(current ?? run, "CANCELLED", null, "cancelled", now);
    }
    const message = error instanceof CrustdataError ? crustdataFailureMessage(error) : error instanceof Error ? error.message : String(error);
    const detail = error instanceof Error ? error.message : String(error);
    const code = error instanceof CrustdataError ? error.code : "RUN_ERROR";
    return fail(run, code, message, now, detail);
  }
}

/** Leads into the table and the watch pool. Re-running replaces the run's lead list, so a resumed run never duplicates. */
async function writeLeads(run: InstantLeadRun, ranked: RankedLead[], now: Date): Promise<number> {
  if (!ranked.length) return 0;
  await db.transaction(async (tx) => {
    const existing = await tx.select({ projectCompanyId: instantLeadRunLeadsTable.projectCompanyId, contactStatus: instantLeadRunLeadsTable.contactStatus })
      .from(instantLeadRunLeadsTable).where(eq(instantLeadRunLeadsTable.runId, run.id));
    const keep = new Set(ranked.map((lead) => lead.projectCompanyId));
    // A lead whose contact was already revealed is never dropped by a re-rank.
    const sticky = existing.filter((lead) => lead.contactStatus !== "NONE" && !keep.has(lead.projectCompanyId)).map((lead) => lead.projectCompanyId);
    const toRemove = existing.filter((lead) => !keep.has(lead.projectCompanyId) && !sticky.includes(lead.projectCompanyId)).map((lead) => lead.projectCompanyId);
    if (toRemove.length) await tx.delete(instantLeadRunLeadsTable).where(and(eq(instantLeadRunLeadsTable.runId, run.id), inArray(instantLeadRunLeadsTable.projectCompanyId, toRemove)));
    for (const [index, lead] of ranked.entries()) {
      await tx.insert(instantLeadRunLeadsTable).values({
        runId: run.id, projectId: run.projectId, projectCompanyId: lead.projectCompanyId, companyId: lead.companyId,
        rank: index + 1, score: lead.score, opportunityState: lead.opportunityState, why: lead.why, signalCodes: lead.signalCodes,
      }).onConflictDoUpdate({
        target: [instantLeadRunLeadsTable.runId, instantLeadRunLeadsTable.projectCompanyId],
        set: { rank: index + 1, score: lead.score, opportunityState: lead.opportunityState, why: lead.why, signalCodes: lead.signalCodes },
      });
    }
  });
  // Delivered leads join the watch pool when there is room; otherwise they stay screened and the note says so.
  const capacity = await watchPoolCapacity(run.organizationId);
  const promote = ranked.slice(0, Math.max(0, capacity.remaining)).map((lead) => lead.projectCompanyId);
  if (promote.length) {
    await db.update(projectCompaniesTable).set({ status: "candidate", updatedAt: now })
      .where(and(inArray(projectCompaniesTable.id, promote), eq(projectCompaniesTable.status, "screening")));
  }
  return ranked.length;
}

/* ------------------------------------------------------------------------ */
/* Scheduling: one run at a time per project, in this process or the queue  */
/* ------------------------------------------------------------------------ */

const inFlight = new Map<string, Promise<InstantLeadRun>>();

/** Starts the oldest queued run for a project unless one is executing. Returns the running promise or null. */
export function kickInstantLeadRuns(deps: InstantLeadRunDeps, projectId?: string): Promise<void> {
  return (async () => {
    const candidates = await db.select({ id: instantLeadRunsTable.id, projectId: instantLeadRunsTable.projectId, status: instantLeadRunsTable.status })
      .from(instantLeadRunsTable)
      .where(and(inArray(instantLeadRunsTable.status, [...INSTANT_LEAD_RUN_WORKING_STATUSES]), ...(projectId ? [eq(instantLeadRunsTable.projectId, projectId)] : [])))
      .orderBy(instantLeadRunsTable.createdAt);
    const byProject = new Map<string, typeof candidates>();
    for (const row of candidates) byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row]);
    for (const [project, rows] of byProject) {
      if (inFlight.has(project)) continue;
      const next = rows[0]!;
      const promise = executeInstantLeadRun(next.id, deps)
        .catch((error) => { deps.log.warn({ runId: next.id, err: error }, "INSTANT_LEADS_RUN_CRASHED"); return null as unknown as InstantLeadRun; })
        .finally(() => { inFlight.delete(project); void kickInstantLeadRuns(deps, project); });
      inFlight.set(project, promise);
    }
  })();
}

export function instantLeadRunInFlight(projectId: string): boolean {
  return inFlight.has(projectId);
}

/** Cancel a queued or running run. Research already paid for stays; leads confirmed so far are delivered and settled. */
export async function cancelInstantLeadRun(runId: string, now = new Date()): Promise<InstantLeadRun | null> {
  const [run] = await db.select().from(instantLeadRunsTable).where(eq(instantLeadRunsTable.id, runId)).limit(1);
  if (!run) return null;
  if (!(INSTANT_LEAD_RUN_WORKING_STATUSES as readonly string[]).includes(run.status)) return run;
  if (run.status === "QUEUED") {
    const settled = await settleCredits(run, 0, now, "cancelled before it started");
    return patchRun(run.id, { status: "CANCELLED", finishedAt: now, etaSeconds: 0, outcomeNote: `Cancelled before it started; ${settled.released} credits released.` }, now);
  }
  if (instantLeadRunInFlight(run.projectId)) {
    // The executor sees the flipped status at its next checkpoint and finishes the run: delivers what is confirmed, settles the hold.
    return patchRun(run.id, { status: "CANCELLED", finishedAt: now, etaSeconds: 0, outcomeNote: "Cancelling; leads confirmed so far are kept." }, now);
  }
  // Nothing is executing it here (a restart, or the queue): finish it now.
  const touched = run.touchedProjectCompanyIds ?? [];
  const ranked = await rankCandidates({ run, projectCompanyIds: touched, limit: run.requested, now }).catch(() => [] as RankedLead[]);
  const delivered = await writeLeads(run, ranked, now);
  const settled = await settleCredits(run, delivered, now, delivered ? `${delivered} delivered before the run was cancelled` : "cancelled before any lead was confirmed");
  return patchRun(run.id, {
    status: "CANCELLED", finishedAt: now, etaSeconds: 0, delivered, confirmed: delivered, pendingProjectCompanyIds: [],
    outcomeNote: delivered
      ? `You cancelled the run. ${delivered} lead${delivered === 1 ? " is" : "s are"} shown; ${settled.settled} credits charged, ${settled.released} released.`
      : `Cancelled before any lead was confirmed. All ${settled.released} credits were released.`,
  }, now);
}

/** What the admin cost page shows per run. */
export async function instantLeadRunLedger(runId: string) {
  return db.select().from(creditLedgerTable).where(sql`${creditLedgerTable.context}->>'runId' = ${runId}`).orderBy(creditLedgerTable.createdAt);
}

export type { InstantLeadRunStatus, ResolvedPlan };
