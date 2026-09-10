import { and, eq } from "drizzle-orm";
import {
  companiesTable,
  db,
  icpCriteriaTable,
  intelligenceV2ChangesetsTable,
  opportunitiesTable,
  projectCompaniesTable,
  projectsTable,
  type Company,
  type Project,
  type ProjectCompany,
} from "@workspace/db";
import { evaluateOpportunity } from "../opportunity-engine";
import { ProviderRouter } from "../provider-router";
import { resolveProjectSellerContext } from "../seller-context";
import { evaluateSignalsForCompany } from "../signal-packs";
import { orchestrateIntelligenceV2, type IntelligenceV2Repository, type IntelligenceV2Result } from "./orchestrator";
import { createProviderRouterResearchInvokerV2 } from "./research-company";
import { icpCriteriaToRequirementsV2 } from "./icp-requirements";
import { loadLatestIntelligenceV2Assessment, persistIntelligenceV2Assessment } from "./persist-assessment";
import { persistIntelligenceV2Evidence } from "./persist-evidence";
import { mapJobsToFacts, persistJobFacts } from "./job-facts";
import { mapEventHitsToFacts, persistEventFacts, researchEvents, type EventFactRow } from "./event-facts";
import { atsHandleFromProfileUrls, atsHandleToProfileUrls, discoverAtsHandle, fetchAtsJobs } from "./ats-boards";
import {
  computeChangeset, evidenceFromRunSnapshot, verdictFromRunSnapshot,
  type ChangesetDiff, type ScoreSnapshot, type VerdictSnapshot,
} from "./changeset";
import {
  ASSESSMENT_POLICY_VERSION, ASSESSMENT_PROMPT_VERSION, COMPANY_PROFILE_VERSION,
  SAFETY_POLICY_VERSION, type EvidenceItemV2,
} from "./schemas";

export type CycleLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

export type OwnedProjectCompany = { project: Project; projectCompany: ProjectCompany; company: Company };

/** Actor recorded on rows a scheduled cycle creates where a user id is required. Not a user. */
export const SCHEDULER_ACTOR = "system:scheduler";

export class SellerContextIncompleteError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Current seller context is incomplete: ${missing.join(", ")}`);
    this.name = "SellerContextIncompleteError";
  }
}

/** Resolve a project company without a membership check — for the scheduler, which acts for the system. */
export async function loadProjectCompany(projectId: string, projectCompanyId: string): Promise<OwnedProjectCompany | null> {
  const [row] = await db.select({ project: projectsTable, projectCompany: projectCompaniesTable, company: companiesTable })
    .from(projectCompaniesTable)
    .innerJoin(projectsTable, eq(projectsTable.id, projectCompaniesTable.projectId))
    .innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .where(and(eq(projectCompaniesTable.id, projectCompanyId), eq(projectCompaniesTable.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

/** The API-shaped run the panel renders and the assessment row stores verbatim. */
export function compactRun(
  result: IntelligenceV2Result,
  projectCompanyId: string,
  contextVersions: { businessTwin: string; offering: string; icp: string },
  evidence: EvidenceItemV2[],
) {
  return {
    intelligenceVersion: result.intelligenceVersion,
    projectId: result.profile.projectId,
    projectCompanyId,
    companyId: result.profile.companyId,
    companyName: result.profile.companyName,
    domain: result.profile.domain,
    createdAt: result.profile.createdAt,
    identity: result.profile.identity,
    primaryBusiness: result.profile.primaryBusiness,
    commercialRole: {
      value: result.assessment.commercialRole.value,
      confidence: result.assessment.commercialRole.confidence,
      reason: result.assessment.commercialRole.reason,
      evidenceIds: result.assessment.commercialRole.evidenceIds,
      claimIds: result.assessment.commercialRole.claimIds,
      claimBindings: result.assessment.commercialRole.claimBindings,
    },
    who: {
      value: result.assessment.who.value,
      confidence: result.assessment.who.confidence,
      reason: result.assessment.who.reason,
      evidenceIds: result.assessment.who.evidenceIds,
      claimIds: result.assessment.who.claimIds,
      claimBindings: result.assessment.who.claimBindings,
      criteria: result.assessment.who.criteria,
    },
    assessmentConfidence: result.assessment.assessmentConfidence,
    resolutionType: result.assessment.resolutionType,
    deterministicOverrides: result.assessment.deterministicOverrides,
    unknownFacts: result.profile.unknownFields,
    evidence: evidence.map((item) => ({
      evidenceId: item.evidenceId,
      sourceType: item.sourceType,
      provider: item.provider,
      url: item.url,
      title: item.title,
      observedAt: item.observedAt,
      statement: item.rawSnippet,
      firstParty: item.firstParty,
      confidence: item.confidence,
      version: item.version,
    })),
    cost: {
      provider: result.observability.providerCost,
      model: result.observability.modelCost,
      total: result.observability.totalCost,
      researchProviderCalls: result.observability.researchProviderCalls,
      modelCalls: result.observability.modelCalls,
    },
    versions: {
      profile: COMPANY_PROFILE_VERSION,
      assessmentPolicy: ASSESSMENT_POLICY_VERSION,
      assessmentPrompt: ASSESSMENT_PROMPT_VERSION,
      safetyPolicy: SAFETY_POLICY_VERSION,
      ...contextVersions,
    },
    fingerprints: {
      profile: result.observability.profileFingerprint,
      assessment: result.observability.assessmentFingerprint,
    },
  };
}
export type CompactRun = ReturnType<typeof compactRun>;

async function readScore(projectCompanyId: string): Promise<ScoreSnapshot | null> {
  const [row] = await db.select({
    score: opportunitiesTable.score, fit: opportunitiesTable.fitScore, need: opportunitiesTable.needScore,
    timing: opportunitiesTable.timingScore, state: opportunitiesTable.state,
  }).from(opportunitiesTable).where(eq(opportunitiesTable.projectCompanyId, projectCompanyId)).limit(1);
  if (!row) return null;
  return { score: row.score, fit: row.fit, need: row.need, timing: row.timing, state: row.state };
}

const verdictOf = (run: CompactRun): VerdictSnapshot => ({
  commercialRole: run.commercialRole.value,
  who: run.who.value,
  criteria: Object.fromEntries(run.who.criteria.map((criterion) => [criterion.criterionId, criterion.result])),
});

/**
 * One complete look at one company: research, assess, gather hiring facts,
 * persist, evaluate signals, re-score, and record what changed.
 *
 * This is the whole pipeline the Analyze button runs, lifted out of the route
 * so a scheduler can run it with no request and no user. The route keeps
 * authentication and the response; everything that changes the database is
 * here, in the order it has to happen in — signals before scoring, because
 * the score is derived from signals and would otherwise land a cycle late.
 *
 * The changeset is computed against the previous persisted run and written
 * last, so a cycle that fails partway leaves no "nothing changed" record it
 * did not earn.
 */
export async function runIntelligenceCycle(input: {
  owned: OwnedProjectCompany;
  repository: IntelligenceV2Repository;
  trigger: "MANUAL" | "SCHEDULED";
  actorId: string;
  now?: Date;
  log: CycleLogger;
}): Promise<{ run: CompactRun; result: IntelligenceV2Result; assessmentId: string; changeset: ChangesetDiff }> {
  const { owned, log } = input;
  const projectId = owned.project.id;
  const projectCompanyId = owned.projectCompany.id;
  const organizationId = owned.project.organizationId;

  const seller = await resolveProjectSellerContext(projectId, organizationId);
  if (!seller.businessTwinReady || !seller.offeringReady || !seller.icpReady
    || !seller.businessTwinVersionId || !seller.icpVersionId) {
    throw new SellerContextIncompleteError(seller.missingRequirements);
  }
  const criteria = await db.select().from(icpCriteriaTable).where(and(
    eq(icpCriteriaTable.projectId, projectId),
    eq(icpCriteriaTable.icpVersionId, seller.icpVersionId),
    eq(icpCriteriaTable.accepted, true),
  ));
  const requirements = icpCriteriaToRequirementsV2(criteria);

  // What the last cycle knew, read before anything is written.
  const previousRow = await loadLatestIntelligenceV2Assessment(projectId, projectCompanyId);
  const before = {
    profileFingerprint: previousRow?.profileFingerprint ?? null,
    evidence: evidenceFromRunSnapshot(previousRow?.runSnapshot),
    verdict: verdictFromRunSnapshot(previousRow?.runSnapshot),
    score: await readScore(projectCompanyId),
  };

  const result = await orchestrateIntelligenceV2({
    request: {
      organizationId, projectId, companyId: owned.company.id,
      companyName: owned.company.canonicalName, domain: owned.company.domain,
      source: "EXISTING_COMPANY", firstPartyEvidence: [],
    },
    context: {
      organizationId, projectId,
      businessTwinVersion: seller.businessTwinVersionId,
      offeringVersion: seller.opportunityPackVersionId ?? seller.context.fingerprint,
      icpVersion: seller.icpVersionId,
      sellerBusinessTwin: { rawAnswers: seller.businessTwinRawAnswers, interpretation: seller.businessTwinAiInterpretation },
      offering: {
        name: seller.context.offeringName, description: seller.context.offeringDescription,
        materialCapabilities: seller.context.offeringCapabilities, exclusions: seller.context.offeringExclusions,
      },
      icp: { requirements, assumptions: seller.icpAssumptions },
    },
    repository: input.repository,
    researchInvoker: createProviderRouterResearchInvokerV2(new ProviderRouter()),
    now: input.now,
  });
  const run = compactRun(result, projectCompanyId, {
    businessTwin: seller.businessTwinVersionId,
    offering: seller.opportunityPackVersionId ?? seller.context.fingerprint,
    icp: seller.icpVersionId,
  }, result.evidence);
  const completedAt = input.now ?? new Date();

  // Hiring is the only event evidence JYRA gathers, and every signal definition
  // keys on events — so this is what puts a number in Need and Timing. It runs
  // outside the transaction because a provider call must never hold a row lock,
  // and it is non-fatal: a search failure degrades the run, it does not fail it.
  let jobFacts: Awaited<ReturnType<typeof mapJobsToFacts>> = { facts: [], skipped: [] };
  let discoveredAtsHandle: ReturnType<typeof atsHandleFromProfileUrls> = null;
  let jobSource = "NONE";
  let atsDiscoveredVia: string | null = null;
  try {
    let handle = atsHandleFromProfileUrls(owned.company.profileUrls);
    if (!handle) {
      const discovered = await discoverAtsHandle(owned.company.domain, owned.company.canonicalName);
      if (discovered) {
        handle = discovered.handle;
        discoveredAtsHandle = discovered.handle;
        atsDiscoveredVia = discovered.via;
      }
    }
    let postings: Awaited<ReturnType<typeof fetchAtsJobs>> = null;
    if (handle) {
      postings = await fetchAtsJobs(handle, owned.company.canonicalName);
      if (postings?.length) jobSource = `ATS:${handle.kind}`;
    }
    if (!postings?.length) {
      const jobs = await new ProviderRouter().getJobs({
        requestId: `${projectCompanyId}:jobs`,
        companyName: owned.company.canonicalName,
        ...(owned.company.domain ? { domain: owned.company.domain } : {}),
        limit: 25,
      });
      if (jobs.status === "success" && jobs.data?.jobs?.length) {
        postings = jobs.data.jobs;
        jobSource = `SEARCH:${jobs.providerId}`;
      }
    }
    if (postings?.length) {
      jobFacts = mapJobsToFacts(postings, { companyName: owned.company.canonicalName, now: completedAt });
    }
    log.info({
      projectCompanyId, jobSource, atsBoard: handle?.boardUrl ?? null, atsDiscoveredVia,
      postingsReturned: postings?.length ?? 0, factsUsable: jobFacts.facts.length,
      skipped: jobFacts.skipped.map((entry) => entry.reason),
    }, "JOB_EVENT_RESEARCH");
  } catch (error) {
    log.warn({ err: error, projectCompanyId }, "JOB_EVENT_RESEARCH_FAILED");
  }

  // Events other than hiring: security incidents and leadership changes,
  // from a targeted news search, extracted deterministically and validated
  // against the page. Same rules as the job pass — outside the transaction,
  // non-fatal, and a provider miss is a quieter run rather than a failed one.
  let eventFacts: EventFactRow[] = [];
  try {
    const router = new ProviderRouter();
    const events = await researchEvents(
      (request) => router.searchWeb(request).then((r) => ({ status: r.status, data: r.data, providerId: r.providerId })),
      { requestId: `${projectCompanyId}:events`, companyName: owned.company.canonicalName, domain: owned.company.domain, now: completedAt },
    );
    const mapped = mapEventHitsToFacts(events.hits, {
      companyId: owned.company.id, companyName: owned.company.canonicalName, domain: owned.company.domain, now: completedAt,
    });
    eventFacts = mapped.facts;
    const reasons = mapped.skipped.reduce<Record<string, number>>((acc, item) => { acc[item.reason] = (acc[item.reason] ?? 0) + 1; return acc; }, {});
    log.info({
      projectCompanyId, queries: events.queries, providers: events.providers, hits: events.hits.length,
      factsUsable: eventFacts.length, byKind: eventFacts.reduce<Record<string, number>>((acc, f) => { acc[f.kind] = (acc[f.kind] ?? 0) + 1; return acc; }, {}),
      skipped: reasons,
    }, "EVENT_RESEARCH");
  } catch (error) {
    log.warn({ err: error, projectCompanyId }, "EVENT_RESEARCH_FAILED");
  }

  let factsAdded = 0;
  const persisted = await db.transaction(async (tx) => {
    const row = await persistIntelligenceV2Assessment({
      organizationId, projectId, projectCompanyId, companyId: owned.company.id,
      icpVersionId: seller.icpVersionId ?? null, result, runSnapshot: run,
    }, tx);
    const evidence = await persistIntelligenceV2Evidence({
      companyId: owned.company.id, companyDomain: owned.company.domain, evidence: result.evidence, now: completedAt,
    }, tx);
    log.info({ assessmentId: row.id, evidenceInserted: evidence.inserted, evidenceReused: evidence.reused, evidenceSkipped: evidence.skipped }, "V2_EVIDENCE_PERSISTED");
    if (discoveredAtsHandle) {
      await tx.update(companiesTable).set({
        profileUrls: { ...owned.company.profileUrls, ...atsHandleToProfileUrls(discoveredAtsHandle) },
        updatedAt: completedAt,
      }).where(eq(companiesTable.id, owned.company.id));
    }
    if (jobFacts.facts.length) {
      const stored = await persistJobFacts({
        organizationId, companyId: owned.company.id, companyDomain: owned.company.domain,
        facts: jobFacts.facts, now: completedAt,
      }, tx);
      factsAdded = stored.factsInserted;
      log.info({ assessmentId: row.id, ...stored }, "JOB_FACTS_PERSISTED");
    }
    if (eventFacts.length) {
      const stored = await persistEventFacts({
        organizationId, companyId: owned.company.id, companyDomain: owned.company.domain, facts: eventFacts, now: completedAt,
      }, tx);
      factsAdded += stored.factsInserted;
      log.info({ assessmentId: row.id, ...stored }, "EVENT_FACTS_PERSISTED");
    }
    await tx.update(projectCompaniesTable).set({
      researchStatus: "complete", latestResearchAt: completedAt, updatedAt: completedAt,
    }).where(eq(projectCompaniesTable.id, projectCompanyId));
    return row;
  });

  // Signals are derived from facts, and the score is derived from signals, so
  // this has to run before the re-score. Neither failure turns a completed
  // run into an error — the persisted assessment stands.
  let signalsCreated = 0;
  try {
    const signals = await evaluateSignalsForCompany({ organizationId, projectId, companyId: owned.company.id, now: completedAt });
    signalsCreated = signals.created.length;
  } catch (error) {
    log.warn({ err: error, projectCompanyId }, "SIGNAL_EVALUATION_FAILED");
  }
  try {
    await evaluateOpportunity({ organizationId, projectId, projectCompanyId, userId: input.actorId, now: completedAt });
  } catch (error) {
    log.warn({ err: error, assessmentId: persisted.id, projectCompanyId }, "Opportunity re-evaluation after Intelligence Core V2 run failed; the persisted assessment is unaffected");
  }

  const changeset = computeChangeset(before, {
    profileFingerprint: run.fingerprints.profile,
    evidence: run.evidence.map((item) => ({ evidenceId: item.evidenceId, version: item.version, sourceType: item.sourceType, title: item.title, url: item.url })),
    verdict: verdictOf(run),
    score: await readScore(projectCompanyId),
    factsAdded,
    signalsCreated,
  });
  await db.insert(intelligenceV2ChangesetsTable).values({
    organizationId, projectId, projectCompanyId, companyId: owned.company.id,
    assessmentId: persisted.id, trigger: input.trigger, observedAt: completedAt,
    ...changeset,
    modelCalls: result.observability.modelCalls,
    costTotal: result.observability.totalCost,
  });

  log.info({
    assessmentId: persisted.id, companyId: run.companyId, trigger: input.trigger,
    profileFingerprint: run.fingerprints.profile, assessmentFingerprint: run.fingerprints.assessment,
    evidenceCount: result.observability.evidenceCount, researchProviderCalls: result.observability.researchProviderCalls,
    modelCalls: result.observability.modelCalls, commercialRole: run.commercialRole.value, who: run.who.value,
    hasChanges: changeset.hasChanges, evidenceAdded: changeset.evidenceAdded.length, evidenceRemoved: changeset.evidenceRemoved.length,
    verdictChanged: changeset.verdictChanged, scoreChanged: changeset.scoreChanged, factsAdded, signalsCreated,
    cost: run.cost.total, duration: result.observability.durationMs,
  }, "Completed Intelligence Core V2 cycle");

  return { run, result, assessmentId: persisted.id, changeset };
}
