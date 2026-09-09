import { and, eq, sql } from "drizzle-orm";
import { db, intelligenceV2CacheTable } from "@workspace/db";
import type { IntelligenceV2CacheScope, IntelligenceV2Repository } from "./orchestrator";
import type { CompanyIntelligenceProfileV2, ResearchPackageV2, SellerRelativeAssessmentV2 } from "./schemas";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type CacheKind = "RESEARCH" | "PROFILE" | "ASSESSMENT";
type CacheScope = IntelligenceV2CacheScope;


/**
 * The orchestrator's cache, kept in Postgres instead of a Map.
 *
 * The interface is unchanged, so the orchestrator's guards — scope checks on
 * cached research and profiles, normalisation and validation of a cached
 * assessment, discarding one that abstained on a fabricated citation — all
 * still run on every read. This class only decides where the bytes live.
 *
 * An assessment carries no tenant scope of its own, so the orchestrator
 * passes it explicitly. The class holds no per-run state and one instance
 * can serve concurrent requests.
 */
export class PostgresIntelligenceV2Repository implements IntelligenceV2Repository {
  constructor(private readonly executor: DbExecutor = db) {}

  private async read<T>(kind: CacheKind, key: string): Promise<T | null> {
    const [row] = await this.executor
      .select({ payload: intelligenceV2CacheTable.payload })
      .from(intelligenceV2CacheTable)
      .where(and(eq(intelligenceV2CacheTable.kind, kind), eq(intelligenceV2CacheTable.cacheKey, key)))
      .limit(1);
    return (row?.payload as T | undefined) ?? null;
  }

  private async write(kind: CacheKind, key: string, scope: CacheScope, payload: Record<string, unknown>): Promise<void> {
    await this.executor
      .insert(intelligenceV2CacheTable)
      .values({ kind, cacheKey: key, ...scope, payload })
      .onConflictDoUpdate({
        target: [intelligenceV2CacheTable.kind, intelligenceV2CacheTable.cacheKey],
        set: { payload, ...scope, updatedAt: sql`now()` },
      });
  }

  async getResearch(key: string) {
    return this.read<ResearchPackageV2>("RESEARCH", key);
  }

  async putResearch(key: string, value: ResearchPackageV2, scope?: CacheScope) {
    await this.write("RESEARCH", key, scope ?? { organizationId: value.organizationId, projectId: value.projectId, companyId: value.companyId }, value as unknown as Record<string, unknown>);
  }

  async getProfile(fingerprint: string) {
    return this.read<CompanyIntelligenceProfileV2>("PROFILE", fingerprint);
  }

  async putProfile(fingerprint: string, value: CompanyIntelligenceProfileV2, scope?: CacheScope) {
    await this.write("PROFILE", fingerprint, scope ?? { organizationId: value.organizationId, projectId: value.projectId, companyId: value.companyId }, value as unknown as Record<string, unknown>);
  }

  async getAssessment(fingerprint: string) {
    return this.read<SellerRelativeAssessmentV2>("ASSESSMENT", fingerprint);
  }

  async putAssessment(fingerprint: string, value: SellerRelativeAssessmentV2, scope?: CacheScope) {
    if (!scope) throw new Error("V2_CACHE_SCOPE_REQUIRED: an assessment cannot be filed without its tenant scope");
    await this.write("ASSESSMENT", fingerprint, scope, value as unknown as Record<string, unknown>);
  }
}
