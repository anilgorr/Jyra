import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  companiesTable,
  companyEvidenceTable,
  companyFactsTable,
  crawlPagesTable,
  dataProvidersTable,
  db,
  evidenceAttributionReviewsTable,
  signalsTable,
} from "@workspace/db";
import {
  assessWebSearchEntityAttribution,
  canonicalSourceIdentity,
  normalizeEvidenceContent,
} from "../src/lib/evidence";
import { revokeRejectedEvidenceIntelligence } from "../src/lib/evidence-quality-revocation";

const COMPANY_DOMAIN = "7cstudio.com";

function contentFingerprint(rawContent: string): string {
  const withoutSourceFooter = rawContent
    .replace(/\n+\s*Source URL:\s*https?:\/\/\S+\s*$/i, "")
    .trim();
  return createHash("sha256")
    .update(normalizeEvidenceContent(withoutSourceFooter))
    .digest("hex");
}

function wrongEntityOverride(
  sourceUrl: string,
  rawContent: string,
  decision: ReturnType<typeof assessWebSearchEntityAttribution>,
) {
  const searchable = `${sourceUrl}\n${rawContent}`.toLowerCase();
  if (searchable.includes("storytelling agency") || searchable.includes("7c_studio_photography")) {
    return {
      ...decision,
      entityStatus: "WRONG_ENTITY" as const,
      entityConfidence: 0,
      entityReason: searchable.includes("storytelling agency")
        ? "The source identifies a San Francisco storytelling agency, not the Bengaluru software company at 7cstudio.com."
        : "The source identifies a photography studio and provides no link to the software company at 7cstudio.com.",
      acceptedAsEvidence: false,
    };
  }
  return decision;
}

async function run() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("This evidence-quality reprocessor is development-only");
  }

  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.domain, COMPANY_DOMAIN))
    .limit(1);
  if (!company) throw new Error("7C Studio canonical company record was not found");

  const [provider] = await db
    .select()
    .from(dataProvidersTable)
    .where(eq(dataProvidersTable.providerType, "tavily"))
    .limit(1);
  if (!provider) throw new Error("Tavily provider registration was not found");

  const rows = await db
    .select({
      crawl: crawlPagesTable,
      evidence: companyEvidenceTable,
    })
    .from(crawlPagesTable)
    .leftJoin(
      companyEvidenceTable,
      eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id),
    )
    .where(
      and(
        eq(crawlPagesTable.companyId, company.id),
        eq(crawlPagesTable.provider, provider.id),
      ),
    );
  if (!rows.length) throw new Error("No stored 7C Studio Tavily results were found");

  const canonicalByIdentity = new Map<string, typeof rows[number]>();
  const canonicalByContent = new Map<string, typeof rows[number]>();
  const ordered = [...rows].sort((left, right) => {
    if (Boolean(left.evidence) !== Boolean(right.evidence)) {
      return left.evidence ? -1 : 1;
    }
    return left.crawl.observedAt.getTime() - right.crawl.observedAt.getTime();
  });
  for (const row of ordered) {
    const identity = canonicalSourceIdentity(row.crawl.sourceUrl);
    const fingerprint = contentFingerprint(row.crawl.rawContent);
    if (!canonicalByIdentity.has(identity)) canonicalByIdentity.set(identity, row);
    if (!canonicalByContent.has(fingerprint)) canonicalByContent.set(fingerprint, row);
  }

  const [{ count: factsBefore }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(companyFactsTable)
    .where(eq(companyFactsTable.companyId, company.id));
  const [{ count: signalsBefore }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(signalsTable)
    .where(eq(signalsTable.companyId, company.id));

  const reviewedAt = new Date();
  const report = [];
  for (const row of rows) {
    const rawTitle = row.crawl.rawContent.split("\n")[0]?.trim() || undefined;
    let decision = assessWebSearchEntityAttribution({
      sourceUrl: row.crawl.sourceUrl,
      title: rawTitle,
      rawContent: row.crawl.rawContent,
      sourceType: row.crawl.sourceType,
      company,
    });
    decision = wrongEntityOverride(
      row.crawl.sourceUrl,
      row.crawl.rawContent,
      decision,
    );

    const identityCanonical = canonicalByIdentity.get(
      canonicalSourceIdentity(row.crawl.sourceUrl),
    );
    const contentCanonical = canonicalByContent.get(
      contentFingerprint(row.crawl.rawContent),
    );
    const canonical = identityCanonical?.crawl.id !== row.crawl.id
      ? identityCanonical
      : contentCanonical?.crawl.id !== row.crawl.id
        ? contentCanonical
        : null;
    const acceptedAsEvidence = decision.acceptedAsEvidence && !canonical;

    await db
      .insert(evidenceAttributionReviewsTable)
      .values({
        crawlPageId: row.crawl.id,
        companyId: company.id,
        reviewedByOrganizationId: row.evidence?.createdByOrganizationId ?? null,
        sourceClassification: decision.sourceClassification,
        entityStatus: decision.entityStatus,
        entityConfidence: decision.entityConfidence,
        entityReason: decision.entityReason,
        sourceReliabilityScore: decision.sourceReliabilityScore,
        qualityReason: decision.qualityReason,
        acceptedAsEvidence,
        duplicateOfCrawlPageId: canonical?.crawl.id ?? null,
        reviewedAt,
      })
      .onConflictDoUpdate({
        target: evidenceAttributionReviewsTable.crawlPageId,
        set: {
          sourceClassification: decision.sourceClassification,
          entityStatus: decision.entityStatus,
          entityConfidence: decision.entityConfidence,
          entityReason: decision.entityReason,
          sourceReliabilityScore: decision.sourceReliabilityScore,
          qualityReason: decision.qualityReason,
          acceptedAsEvidence,
          duplicateOfCrawlPageId: canonical?.crawl.id ?? null,
          reviewedAt,
        },
      });

    if (row.evidence) {
      await db
        .update(companyEvidenceTable)
        .set({
          status: acceptedAsEvidence ? row.evidence.status : "CONFLICTING",
          updatedAt: reviewedAt,
        })
        .where(eq(companyEvidenceTable.id, row.evidence.id));
    }

    report.push({
      sourceUrl: row.crawl.sourceUrl,
      sourceClassification: decision.sourceClassification,
      entityStatus: decision.entityStatus,
      entityConfidence: decision.entityConfidence,
      acceptedAsEvidence,
      duplicate: Boolean(canonical),
      duplicateOf: canonical?.crawl.sourceUrl ?? null,
      reason: canonical
        ? `${decision.entityReason} Duplicate of the canonical stored result ${canonical.crawl.sourceUrl}.`
        : decision.entityReason,
      evidenceId: row.evidence?.id ?? null,
      crawlPageId: row.crawl.id,
    });
  }

  const [{ count: factsAfter }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(companyFactsTable)
    .where(eq(companyFactsTable.companyId, company.id));
  const [{ count: signalsAfter }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(signalsTable)
    .where(eq(signalsTable.companyId, company.id));
  const revocation = await revokeRejectedEvidenceIntelligence(company.id);

  console.log(JSON.stringify({
    company: company.canonicalName,
    canonicalDomain: company.domain,
    provider: provider.name,
    reviewedAt: reviewedAt.toISOString(),
    resultsReviewed: report.length,
    report,
    counts: {
      confirmed: report.filter((item) => item.entityStatus === "CONFIRMED_ENTITY").length,
      probable: report.filter((item) => item.entityStatus === "PROBABLE_ENTITY").length,
      ambiguous: report.filter((item) => item.entityStatus === "AMBIGUOUS_ENTITY").length,
      wrongEntity: report.filter((item) => item.entityStatus === "WRONG_ENTITY").length,
      duplicatesFound: report.filter((item) => item.duplicate).length,
      canonicalEvidenceItems: report.filter((item) => item.acceptedAsEvidence).length,
      signalEligibleEvidence: report.filter((item) => item.acceptedAsEvidence).length,
      factsBefore: Number(factsBefore),
      factsAfter: Number(factsAfter),
      signalsBefore: Number(signalsBefore),
      signalsAfter: Number(signalsAfter),
      ...revocation,
    },
  }, null, 2));
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Evidence reprocessing failed");
  process.exitCode = 1;
});