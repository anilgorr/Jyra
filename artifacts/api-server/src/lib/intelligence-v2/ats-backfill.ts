import { eq } from "drizzle-orm";
import { companiesTable, db } from "@workspace/db";
import {
  atsHandleFromProfileUrls,
  atsHandleToProfileUrls,
  discoverAtsHandle,
} from "./ats-boards";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AtsCompanyRow = {
  id: string;
  canonicalName: string;
  domain: string | null;
  profileUrls: Record<string, string> | null;
};

/** The two things the backfill needs from storage. Kept thin so the policy is testable without a database. */
export type AtsCompanyStore = {
  listCompanies(): Promise<AtsCompanyRow[]>;
  saveProfileUrls(companyId: string, profileUrls: Record<string, string>, now: Date): Promise<void>;
};

export function postgresAtsCompanyStore(executor: DbExecutor = db): AtsCompanyStore {
  return {
    async listCompanies() {
      return executor
        .select({
          id: companiesTable.id,
          canonicalName: companiesTable.canonicalName,
          domain: companiesTable.domain,
          profileUrls: companiesTable.profileUrls,
        })
        .from(companiesTable);
    },
    async saveProfileUrls(companyId, profileUrls, now) {
      await executor.update(companiesTable)
        .set({ profileUrls, updatedAt: now })
        .where(eq(companiesTable.id, companyId));
    },
  };
}

/** When discovery last came up empty for a company. Stored beside the handle keys. */
export const ATS_PROBED_AT_KEY = "atsProbedAt";

/** How long a miss stands before the company is worth probing again. */
export const ATS_REPROBE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export type AtsBackfillOutcome = {
  companyId: string;
  domain: string | null;
  name: string;
  result: "found" | "missed" | "skipped_recent_miss" | "skipped_no_domain" | "already_known" | "failed";
  via?: string;
  kind?: string;
  error?: string;
};

export type AtsBackfillReport = {
  considered: number;
  found: number;
  missed: number;
  skipped: number;
  failed: number;
  outcomes: AtsBackfillOutcome[];
};

/**
 * Decide whether a company is due for board discovery, from its profile alone.
 *
 * Exported so the scheduler can ask the same question the backfill does. A
 * known handle is never re-probed here — a board that goes dark is a
 * source-health problem, not a discovery one. A miss is retried after
 * ATS_REPROBE_AFTER_MS, because companies do adopt an ATS.
 */
export function atsDiscoveryDue(
  profileUrls: Record<string, string> | null | undefined,
  now: Date,
): "known" | "recent_miss" | "due" {
  if (atsHandleFromProfileUrls(profileUrls)) return "known";
  const probedAt = profileUrls?.[ATS_PROBED_AT_KEY];
  if (probedAt) {
    const then = Date.parse(probedAt);
    if (Number.isFinite(then) && now.getTime() - then < ATS_REPROBE_AFTER_MS) return "recent_miss";
  }
  return "due";
}

/**
 * Run board discovery across every company that needs it.
 *
 * Two of sixty-six companies had a known board when this was written, and the
 * four-rung waterfall that finds them had only ever run on a handful. This is
 * the difference between one signal and a population — and it is free: no
 * model calls, no paid providers, just public careers pages and ATS APIs.
 *
 * Concurrency is deliberately low. Each discovery is a handful of HTTP
 * requests to sites that owe us nothing; three at a time is polite and still
 * finishes sixty companies in a few minutes.
 */
export async function backfillAtsHandles(input: {
  store?: AtsCompanyStore;
  now?: Date;
  limit?: number;
  concurrency?: number;
  /** Re-probe companies whose last miss is younger than ATS_REPROBE_AFTER_MS. */
  force?: boolean;
  onOutcome?: (outcome: AtsBackfillOutcome) => void;
  discover?: typeof discoverAtsHandle;
} = {}): Promise<AtsBackfillReport> {
  const store = input.store ?? postgresAtsCompanyStore();
  const now = input.now ?? new Date();
  const discover = input.discover ?? discoverAtsHandle;
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 3, 8));

  const companies = await store.listCompanies();

  const report: AtsBackfillReport = { considered: 0, found: 0, missed: 0, skipped: 0, failed: 0, outcomes: [] };
  const record = (outcome: AtsBackfillOutcome) => {
    report.outcomes.push(outcome);
    if (outcome.result === "found") report.found++;
    else if (outcome.result === "missed") report.missed++;
    else if (outcome.result === "failed") report.failed++;
    else report.skipped++;
    input.onOutcome?.(outcome);
  };

  const queue: typeof companies = [];
  for (const company of companies) {
    if (input.limit !== undefined && queue.length >= input.limit) break;
    const base = { companyId: company.id, domain: company.domain, name: company.canonicalName };
    const due = atsDiscoveryDue(company.profileUrls, now);
    if (due === "known") { record({ ...base, result: "already_known", kind: company.profileUrls?.atsKind }); continue; }
    if (due === "recent_miss" && !input.force) { record({ ...base, result: "skipped_recent_miss" }); continue; }
    if (!company.domain) { record({ ...base, result: "skipped_no_domain" }); continue; }
    queue.push(company);
  }
  report.considered = queue.length;

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const company = queue[cursor++]!;
      const base = { companyId: company.id, domain: company.domain, name: company.canonicalName };
      try {
        const hit = await discover(company.domain, company.canonicalName);
        const merged: Record<string, string> = { ...(company.profileUrls ?? {}) };
        if (hit) {
          Object.assign(merged, atsHandleToProfileUrls(hit.handle));
          delete merged[ATS_PROBED_AT_KEY];
        } else {
          merged[ATS_PROBED_AT_KEY] = now.toISOString();
        }
        await store.saveProfileUrls(company.id, merged, now);
        record(hit
          ? { ...base, result: "found", via: hit.via, kind: hit.handle.kind }
          : { ...base, result: "missed" });
      } catch (error) {
        record({ ...base, result: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return report;
}
