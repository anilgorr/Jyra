import { and, eq, isNull, like, or } from "drizzle-orm";
import { db, companiesTable, companyEvidenceTable, projectCompaniesTable } from "@workspace/db";
import { headcountFromProfiles, type HeadcountCandidate } from "./headcount-from-profile";

/**
 * Fill in the headcount the project's stored pages already state.
 *
 * Costs nothing: it reads company_evidence that the research pass already
 * paid for. It never overwrites a headcount that is already there, and it
 * writes a band rather than a count, because a band is what the source says.
 *
 * Separate from the research cycle on purpose. The pool was researched before
 * anything read this field, so the evidence exists and the column does not,
 * and waiting for the next cycle would mean paying again for pages already in
 * the database.
 */
export type HeadcountBackfillReport = {
  projectId: string;
  companies: number;
  examined: number;
  filled: number;
  /** Stated a size, but no stored page named the company's own domain, or two pages disagreed. */
  unattributable: number;
  skippedAlreadySet: number;
  samples: Array<{ company: string; range: string; sourceUrl: string }>;
};

export async function backfillHeadcountForProject(projectId: string): Promise<HeadcountBackfillReport> {
  const rows = await db
    .select({ company: companiesTable })
    .from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(eq(projectCompaniesTable.projectId, projectId));

  const report: HeadcountBackfillReport = {
    projectId, companies: rows.length, examined: 0, filled: 0,
    unattributable: 0, skippedAlreadySet: 0, samples: [],
  };

  for (const { company } of rows) {
    if (company.employeeCount !== null || company.employeeRange !== null) {
      report.skippedAlreadySet += 1;
      continue;
    }
    if (!company.domain) continue;
    const evidence = await db
      .select({ id: companyEvidenceTable.id, url: companyEvidenceTable.sourceUrl, claim: companyEvidenceTable.extractedClaim })
      .from(companyEvidenceTable)
      .where(and(
        eq(companyEvidenceTable.companyId, company.id),
        or(
          like(companyEvidenceTable.sourceUrl, "%linkedin.com/company/%"),
          like(companyEvidenceTable.sourceUrl, "%linkedin.com/showcase/%"),
        ),
      ));
    if (!evidence.length) continue;
    report.examined += 1;
    const candidates: HeadcountCandidate[] = evidence.map((row) => ({
      evidenceId: row.id, sourceUrl: row.url, text: row.claim,
    }));
    const found = headcountFromProfiles(candidates, company.domain);
    if (!found) {
      report.unattributable += 1;
      continue;
    }
    await db.update(companiesTable)
      .set({ employeeRange: found.range, employeeMin: found.min, employeeMax: found.max })
      // Written only while it is still empty, so a concurrent enrichment wins
      // rather than being silently replaced by a band.
      .where(and(eq(companiesTable.id, company.id), isNull(companiesTable.employeeRange), isNull(companiesTable.employeeCount)));
    report.filled += 1;
    if (report.samples.length < 10) {
      report.samples.push({ company: company.canonicalName, range: found.range, sourceUrl: found.sourceUrl });
    }
  }
  return report;
}
