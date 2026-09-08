import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { companyEvidenceTable, crawlPagesTable, db } from "@workspace/db";
import { calculateEvidenceScores, hashNormalizedContent } from "../evidence";
import type { EvidenceItemV2 } from "./schemas";

/**
 * Durable evidence for the Intelligence Core V2.
 *
 * V2 gathers evidence, splits it into atomic claims, validates every citation
 * against those claims, and then - until now - dropped the whole lot when the
 * request ended. Only the verdict was persisted. That is the wrong half to
 * keep: the verdict is the cheap part, and the claims behind it are both the
 * audit trail a buyer asks for ("why is this company a fit?") and the raw
 * material that facts and signals are derived from. With zero evidence rows in
 * the database, Need and Timing had no possible source, which is why every
 * company in the product scored on Fit alone.
 *
 * The mapping below is pure so it can be tested without a database. The
 * persistence wrapper is a thin shell around it.
 */

export type EvidenceSourceType =
  | "company_website" | "careers_page" | "job_posting" | "press_release" | "news"
  | "blog" | "trust_security_compliance" | "technology" | "public_social" | "other";

/** V2 speaks in capability names; the evidence table predates them. */
const SOURCE_TYPE_BY_V2_KIND: Record<string, EvidenceSourceType> = {
  FIRST_PARTY_WEBSITE: "company_website",
  COMPANY_PROFILE_RESOLUTION: "public_social",
  COMPANY_LOOKUP: "other",
  COMPANY_FIRMOGRAPHICS: "public_social",
  WEBSITE_CRAWL: "company_website",
  WEB_SEARCH: "other",
  NEWS_SEARCH: "news",
  JOB_SEARCH: "job_posting",
  LEADERSHIP_SEARCH: "public_social",
  PUBLIC_SOCIAL_SEARCH: "public_social",
  TECH_STACK: "technology",
};

/** Directories and social platforms: about a company, never by it. */
const THIRD_PARTY_PLATFORMS = new Set([
  "linkedin.com", "crunchbase.com", "glassdoor.com", "indeed.com", "x.com",
  "twitter.com", "facebook.com", "instagram.com", "youtube.com", "github.com",
  "g2.com", "capterra.com", "trustpilot.com", "bloomberg.com", "pitchbook.com",
  "zoominfo.com", "apollo.io", "owler.com", "wikipedia.org", "medium.com",
]);

function isSameOrSubdomain(sourceDomain: string, companyDomain: string): boolean {
  return sourceDomain === companyDomain || sourceDomain.endsWith(`.${companyDomain}`);
}

/**
 * Which kind of source is this, really?
 *
 * The capability that fetched a page does not decide what the page IS. A
 * LinkedIn profile arrives through COMPANY_PROFILE_RESOLUTION, but it is a
 * directory listing about the company, not the company's own website — and
 * `company_website` scores as both authoritative and direct. Trusting the
 * capability name alone let a LinkedIn page for an entirely different company
 * (Coded Lines, FlowForma, KISSFISH) outscore kissflow.com's own site, 84.8
 * to 83.4, in the first real run that persisted evidence.
 *
 * So the domain decides. Only the company's own domain can be its website;
 * known directories are always third-party; the capability is the fallback.
 */
export function evidenceSourceTypeForV2(
  kind: string,
  source?: { sourceDomain: string; companyDomain: string | null },
): EvidenceSourceType {
  const mapped = SOURCE_TYPE_BY_V2_KIND[kind] ?? "other";
  if (!source) return mapped;

  const { sourceDomain, companyDomain } = source;
  if (THIRD_PARTY_PLATFORMS.has(sourceDomain)) {
    return mapped === "job_posting" || mapped === "news" ? mapped : "public_social";
  }
  if (companyDomain && isSameOrSubdomain(sourceDomain, companyDomain)) {
    return mapped === "job_posting" || mapped === "careers_page" ? mapped : "company_website";
  }
  // Not the company's domain, so it cannot be the company's website, whatever
  // capability produced it.
  return mapped === "company_website" ? "other" : mapped;
}

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The human-readable claim stored on the row.
 *
 * Built from the atomic claims rather than the snippet, so the evidence row
 * says what was actually extracted and cited - the thing an assessment points
 * at - instead of a paragraph of page text nobody will read.
 */
export function extractedClaimForV2(item: EvidenceItemV2): string {
  const claims = item.atomicClaims
    .map((claim) => {
      const label = claim.type.toLowerCase().split("_").join(" ");
      const qualifier = claim.geographyType
        ? ` (${claim.geographyType.toLowerCase().split("_").join(" ")})`
        : "";
      return `${label}${qualifier}: ${claim.value}`;
    })
    .slice(0, 12);
  if (!claims.length) return item.title.slice(0, 500);
  return claims.join(" | ").slice(0, 2000);
}

export type V2EvidenceRows = {
  /** Stable across re-runs of the same source, so replays update rather than duplicate. */
  dedupeHash: string;
  v2EvidenceId: string;
  crawlPage: {
    companyId: string; sourceUrl: string; sourceDomain: string;
    sourceType: EvidenceSourceType; provider: string; observedAt: Date;
    rawContent: string; normalizedContentHash: string;
  };
  evidence: {
    companyId: string; createdByOrganizationId: string; sourceUrl: string;
    sourceDomain: string; sourceType: EvidenceSourceType; provider: string;
    observedAt: Date; extractedClaim: string;
    authorityScore: number; directnessScore: number; freshnessScore: number;
    corroborationScore: number; confidence: number;
    status: "VERIFIED" | "RAW";
  };
};

/**
 * Map one V2 evidence item onto the durable evidence tables.
 *
 * Returns null for an item with no usable source URL: an evidence row whose
 * provenance cannot be re-checked is not evidence, and silently inventing a
 * placeholder URL would put an unverifiable row into the audit trail.
 */
export function mapV2EvidenceToRows(
  item: EvidenceItemV2,
  context: { companyDomain: string | null; corroboratingSourceCount?: number; now?: Date },
): V2EvidenceRows | null {
  const sourceUrl = item.finalUrl ?? item.url;
  const sourceDomain = domainOf(sourceUrl);
  if (!sourceUrl || !sourceDomain) return null;

  const sourceType = evidenceSourceTypeForV2(item.sourceType, {
    sourceDomain,
    companyDomain: context.companyDomain,
  });
  const observedAt = new Date(item.observedAt);
  const scores = calculateEvidenceScores({
    sourceType,
    sourceDomain,
    companyDomain: context.companyDomain,
    provider: item.provider,
    publisher: null,
    publishedAt: null,
    observedAt,
    corroboratingSourceCount: context.corroboratingSourceCount,
    now: context.now,
  });

  return {
    // Identity of the SOURCE, not of the run: the same page re-fetched
    // tomorrow is the same evidence, and must not become a second row.
    dedupeHash: createHash("sha256")
      .update([item.companyId, sourceUrl, item.sourceType].join(" "))
      .digest("hex"),
    v2EvidenceId: item.evidenceId,
    crawlPage: {
      companyId: item.companyId, sourceUrl, sourceDomain, sourceType,
      provider: item.provider, observedAt,
      rawContent: item.rawSnippet,
      normalizedContentHash: hashNormalizedContent(item.rawSnippet),
    },
    evidence: {
      companyId: item.companyId,
      createdByOrganizationId: item.organizationId,
      sourceUrl, sourceDomain, sourceType,
      provider: item.provider, observedAt,
      extractedClaim: extractedClaimForV2(item),
      ...scores,
      // V2 evidence has already passed identity and scoping validation before
      // it reaches an assessment. First-party pages are the company speaking
      // about itself and are admitted; anything else is kept RAW and stays
      // ineligible for facts and signals until it is corroborated.
      status: item.firstParty ? "VERIFIED" : "RAW",
    },
  };
}

/** Rows for a whole run, with unusable items reported rather than dropped. */
export function mapV2EvidenceRun(
  evidence: EvidenceItemV2[],
  context: { companyDomain: string | null; now?: Date },
): { rows: V2EvidenceRows[]; skipped: { evidenceId: string; reason: string }[] } {
  const byDomain = new Map<string, number>();
  for (const item of evidence) {
    const domain = domainOf(item.finalUrl ?? item.url);
    if (domain) byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
  }

  const rows: V2EvidenceRows[] = [];
  const skipped: { evidenceId: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const item of evidence) {
    const domain = domainOf(item.finalUrl ?? item.url);
    const mapped = mapV2EvidenceToRows(item, {
      companyDomain: context.companyDomain,
      // Corroboration is how many OTHER distinct sources agree, so a domain
      // that appears once corroborates nothing.
      corroboratingSourceCount: Math.max(0, (domain ? byDomain.get(domain) ?? 1 : 1) - 1),
      now: context.now,
    });
    if (!mapped) {
      skipped.push({ evidenceId: item.evidenceId, reason: "NO_RESOLVABLE_SOURCE_URL" });
      continue;
    }
    if (seen.has(mapped.dedupeHash)) {
      skipped.push({ evidenceId: item.evidenceId, reason: "DUPLICATE_SOURCE_IN_RUN" });
      continue;
    }
    seen.add(mapped.dedupeHash);
    rows.push(mapped);
  }
  return { rows, skipped };
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PersistV2EvidenceResult = {
  inserted: number;
  reused: number;
  skipped: { evidenceId: string; reason: string }[];
  /** V2 evidenceId -> company_evidence.id, so citations resolve to stored rows. */
  evidenceIdMap: Record<string, string>;
};

/**
 * Write a run's evidence to the durable tables, once per source.
 *
 * Idempotent by (company, source url, source kind): re-running an assessment
 * refreshes what was observed instead of stacking a duplicate row every time,
 * which matters because the opportunity engine counts distinct evidence when
 * it computes corroboration and confidence.
 */
export async function persistIntelligenceV2Evidence(
  input: { companyId: string; companyDomain: string | null; evidence: EvidenceItemV2[]; now?: Date },
  executor: DbExecutor,
): Promise<PersistV2EvidenceResult> {
  const { rows, skipped } = mapV2EvidenceRun(input.evidence, {
    companyDomain: input.companyDomain,
    now: input.now,
  });
  const evidenceIdMap: Record<string, string> = {};
  let inserted = 0;
  let reused = 0;

  for (const row of rows) {
    const [existing] = await executor
      .select({ id: companyEvidenceTable.id })
      .from(companyEvidenceTable)
      .where(and(
        eq(companyEvidenceTable.companyId, row.evidence.companyId),
        eq(companyEvidenceTable.sourceUrl, row.evidence.sourceUrl),
        eq(companyEvidenceTable.sourceType, row.evidence.sourceType),
      ))
      .limit(1);

    if (existing) {
      // Same source, seen again: refresh what changed, keep the row's identity
      // so anything already citing it stays valid.
      await executor.update(companyEvidenceTable).set({
        observedAt: row.evidence.observedAt,
        extractedClaim: row.evidence.extractedClaim,
        authorityScore: row.evidence.authorityScore,
        directnessScore: row.evidence.directnessScore,
        freshnessScore: row.evidence.freshnessScore,
        corroborationScore: row.evidence.corroborationScore,
        confidence: row.evidence.confidence,
        updatedAt: new Date(),
      }).where(eq(companyEvidenceTable.id, existing.id));
      evidenceIdMap[row.v2EvidenceId] = existing.id;
      reused += 1;
      continue;
    }

    const crawlPageId = randomUUID();
    await executor.insert(crawlPagesTable).values({
      id: crawlPageId,
      ...row.crawlPage,
      rawContentReference: `crawl_pages:${crawlPageId}`,
    });
    const [created] = await executor.insert(companyEvidenceTable).values({
      crawlPageId,
      rawContentReference: `crawl_pages:${crawlPageId}`,
      ...row.evidence,
    }).returning({ id: companyEvidenceTable.id });
    evidenceIdMap[row.v2EvidenceId] = created.id;
    inserted += 1;
  }

  return { inserted, reused, skipped, evidenceIdMap };
}
