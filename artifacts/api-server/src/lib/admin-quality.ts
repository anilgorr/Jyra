import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { assertAggregateOnly, rate, windowInput } from "./admin-quality-contract";

type Row = Record<string, unknown>;

async function query<T extends Row>(statement: SQL): Promise<T[]> {
  const result = await db.execute(statement);
  return result.rows as T[];
}

function number(value: unknown): number {
  return Number(value ?? 0);
}

export async function getAdminQualityDashboard(days?: number, now = new Date()) {
  const window = windowInput(days, now);
  const since = window.from;
  const until = window.to;

  const [
    providerRows,
    researchRows,
    costRows,
    evidenceRows,
    factRows,
    signalRows,
    signalFalsePositiveRows,
    clusterRows,
    opportunityRows,
    outcomeRows,
    modelRows,
    failedRows,
    staleRows,
  ] = await Promise.all([
    query(sql`
      SELECT p.name AS label, p.enabled, c.capabilities,
        coalesce(u.request_count, 0)::int AS request_count,
        coalesce(u.success_count, 0)::int AS success_count,
        coalesce(u.failure_count, 0)::int AS failure_count,
        coalesce(u.latency_ms, 0)::int AS latency_ms,
        u.last_success_at, u.last_failure_at
      FROM data_providers p
      LEFT JOIN LATERAL (
        SELECT coalesce(array_agg(DISTINCT capability::text), ARRAY[]::text[]) AS capabilities
        FROM provider_capabilities WHERE provider_id = p.id
      ) c ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS request_count,
          count(*) FILTER (WHERE status = 'success')::int AS success_count,
          count(*) FILTER (WHERE status IN ('failed', 'timeout'))::int AS failure_count,
          round(avg(latency_ms))::int AS latency_ms,
          max(completed_at) FILTER (WHERE status = 'success') AS last_success_at,
          max(completed_at) FILTER (WHERE status IN ('failed', 'timeout')) AS last_failure_at
        FROM provider_usage
        WHERE provider_id = p.id AND created_at >= ${since} AND created_at <= ${until}
      ) u ON true
      ORDER BY p.name
    `),
    query(sql`
      SELECT status AS label, count(*)::int AS count
      FROM research_jobs
      WHERE created_at >= ${since} AND created_at <= ${until}
      GROUP BY status ORDER BY status
    `),
    query(sql`
      SELECT
        coalesce(sum(estimated_cost), 0)::float8 AS estimated_cost,
        coalesce(sum(actual_cost), 0)::float8 AS actual_cost,
        count(*)::int AS request_count,
        count(*) FILTER (WHERE success)::int AS successful_request_count,
        coalesce(sum(CASE WHEN result_metadata->>'resultCount' ~ '^[0-9]+([.][0-9]+)?$'
          THEN (result_metadata->>'resultCount')::numeric ELSE 0 END), 0)::float8 AS result_count
      FROM research_request_costs
      WHERE recorded_at >= ${since} AND recorded_at <= ${until}
    `),
    query(sql`
      SELECT status::text || ' · ' || source_type::text AS label, count(*)::int AS count,
        round(avg(confidence)::numeric, 4)::float8 AS average_confidence,
        round(avg(freshness_score)::numeric, 4)::float8 AS average_freshness,
        round(avg(corroboration_score)::numeric, 4)::float8 AS average_corroboration,
        count(*) FILTER (WHERE confidence >= 0.8)::int AS high_confidence_count,
        count(*) FILTER (WHERE freshness_score < 0.5)::int AS stale_count
      FROM company_evidence
      WHERE created_at >= ${since} AND created_at <= ${until}
      GROUP BY status, source_type ORDER BY status, source_type
    `),
    query(sql`
      SELECT status AS label, count(*)::int AS count,
        round(avg(confidence)::numeric, 4)::float8 AS average_confidence,
        count(DISTINCT extractor_version)::int AS extractor_version_count,
        count(*) FILTER (WHERE confidence >= 0.8)::int AS high_confidence_count,
        count(*) FILTER (WHERE confidence < 0.5)::int AS low_confidence_count
      FROM research_fact_proposals
      WHERE created_at >= ${since} AND created_at <= ${until}
      GROUP BY status ORDER BY status
    `),
    query(sql`
      SELECT observed_classification AS label, count(*)::int AS count
      FROM (
        SELECT CASE
          WHEN ro.outcome_type IN ('NOT_USEFUL', 'NEGATIVE_REPLY', 'LOST') THEN 'OBSERVED_FALSE_POSITIVE'
          WHEN ro.outcome_type IN ('USEFUL', 'POSITIVE_REPLY', 'MEETING', 'QUALIFIED', 'PROPOSAL', 'WON') THEN 'OBSERVED_POSITIVE'
          ELSE 'OBSERVED_NEUTRAL'
        END AS observed_classification
        FROM recommendation_outcomes ro
        INNER JOIN recommendation_ledger rl ON rl.id = ro.recommendation_id
        WHERE ro.recorded_at >= ${since} AND ro.recorded_at <= ${until}
          AND jsonb_array_length(rl.signals) > 0
      ) classified
      GROUP BY observed_classification ORDER BY observed_classification
    `),
    query(sql`
      SELECT status AS label, count(*)::int AS count,
        round(avg(confidence)::numeric, 4)::float8 AS average_confidence,
        round(avg(current_strength)::numeric, 4)::float8 AS average_strength,
        count(*) FILTER (WHERE confidence >= 0.8)::int AS high_confidence_count,
        count(*) FILTER (WHERE current_strength >= 0.8)::int AS high_strength_count,
        count(*) FILTER (
          WHERE jsonb_array_length(supporting_fact_ids) > 0
            AND jsonb_array_length(supporting_evidence_ids) > 0
        )::int AS supported_count
      FROM signals
      WHERE created_at >= ${since} AND created_at <= ${until}
      GROUP BY status ORDER BY status
    `),
    query(sql`
      SELECT status AS label, count(*)::int AS count,
        round(avg(confidence)::numeric, 4)::float8 AS average_confidence
      FROM signal_clusters
      WHERE created_at >= ${since} AND created_at <= ${until}
      GROUP BY status ORDER BY status
    `),
    query(sql`
      SELECT state AS label, count(*)::int AS count,
        assessment_status, sum(count(*)) OVER (PARTITION BY assessment_status)::int AS assessment_count
      FROM opportunities
      WHERE assessed_at >= ${since} AND assessed_at <= ${until}
      GROUP BY state, assessment_status ORDER BY state, assessment_status
    `),
    query(sql`
      SELECT outcome_type AS label, count(*)::int AS count
      FROM recommendation_outcomes
      WHERE recorded_at >= ${since} AND recorded_at <= ${until}
      GROUP BY outcome_type ORDER BY outcome_type
    `),
    query(sql`
      SELECT 'opportunity' AS family, version::text AS version, count(*)::int AS observed_count,
        bool_or(active) AS active
      FROM opportunity_model_versions
      WHERE created_at >= ${since} AND created_at <= ${until}
      GROUP BY version
      UNION ALL
      SELECT 'extractor' AS family, extractor_version AS version, count(*)::int, false
      FROM research_fact_proposals
      WHERE created_at >= ${since} AND created_at <= ${until}
      GROUP BY extractor_version
      UNION ALL
      SELECT 'signal-generator' AS family, generator_version AS version, count(*)::int, false
      FROM signals
      WHERE created_at >= ${since} AND created_at <= ${until}
      GROUP BY generator_version
      UNION ALL
      SELECT 'learning-policy' AS family, version::text AS version, count(*)::int, false
      FROM learning_model_versions
      WHERE created_at >= ${since} AND created_at <= ${until}
      GROUP BY version
      ORDER BY family, version
    `),
    query(sql`
      SELECT provider_capability AS label, coalesce(error_code, 'UNSPECIFIED') AS error_code,
        count(*)::int AS count,
        count(*) FILTER (WHERE created_at >= ${until}::timestamptz - interval '24 hours')::int AS last_24h_count
      FROM research_jobs
      WHERE status = 'FAILED' AND created_at >= ${since} AND created_at <= ${until}
      GROUP BY provider_capability, error_code ORDER BY count DESC
      LIMIT 100
    `),
    query(sql`
      SELECT
        count(*) FILTER (WHERE next_refresh_at < ${until})::int AS overdue_count,
        count(*) FILTER (WHERE next_refresh_at < ${until}::timestamptz - interval '7 days')::int AS over_7_days_count,
        count(*) FILTER (WHERE next_refresh_at < ${until}::timestamptz - interval '30 days')::int AS over_30_days_count
      FROM research_questions
      WHERE next_refresh_at IS NOT NULL
        AND next_refresh_at >= ${since} AND next_refresh_at <= ${until}
    `),
  ]);

  const provider = providerRows.map((row) => {
    const requests = number(row.request_count);
    return {
      label: String(row.label),
      enabled: row.enabled === true,
      capabilities: Array.isArray(row.capabilities) ? row.capabilities.map(String) : [],
      requestCount: requests,
      successRate: rate(number(row.success_count), requests),
      failureRate: rate(number(row.failure_count), requests),
      latencyMs: number(row.latency_ms),
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
    };
  });
  const research = researchRows.map((row) => ({ label: String(row.label), count: number(row.count) }));
  const cost = costRows[0] ?? {};
  const costSummary = {
    estimatedCost: number(cost.estimated_cost),
    actualCost: number(cost.actual_cost),
    requestCount: number(cost.request_count),
    successfulRequestCount: number(cost.successful_request_count),
    resultCount: number(cost.result_count),
    costPerSuccessfulRequest: rate(number(cost.actual_cost), number(cost.successful_request_count)),
    costPerResult: rate(number(cost.actual_cost), number(cost.result_count)),
  };

  const response = {
    version: "phase24.v1",
    window: { days: window.days, from: window.from.toISOString(), to: window.to.toISOString() },
    generatedAt: now.toISOString(),
    sections: {
      providerHealth: { sampleSize: provider.reduce((sum, row) => sum + row.requestCount, 0), rows: provider },
      researchSuccess: { sampleSize: research.reduce((sum, row) => sum + row.count, 0), rows: research },
      researchCost: { sampleSize: costSummary.requestCount, summary: costSummary },
      evidenceQuality: { sampleSize: evidenceRows.reduce((sum, row) => sum + number(row.count), 0), rows: evidenceRows },
      factExtractionQuality: { sampleSize: factRows.reduce((sum, row) => sum + number(row.count), 0), rows: factRows },
      signalQuality: { sampleSize: signalRows.reduce((sum, row) => sum + number(row.count), 0), rows: signalRows },
      signalFalsePositives: {
        sampleSize: signalFalsePositiveRows.reduce((sum, row) => sum + number(row.count), 0),
        note: "Outcome classifications are observed associations for recommendations containing signals; they are not causal estimates of any signal's performance.",
        rows: signalFalsePositiveRows,
      },
      clusterPerformance: { sampleSize: clusterRows.reduce((sum, row) => sum + number(row.count), 0), rows: clusterRows },
      opportunityStateDistribution: {
        sampleSize: opportunityRows.reduce((sum, row) => sum + number(row.count), 0),
        rows: opportunityRows,
      },
      outcomeQuality: { sampleSize: outcomeRows.reduce((sum, row) => sum + number(row.count), 0), rows: outcomeRows },
      modelVersions: { sampleSize: modelRows.reduce((sum, row) => sum + number(row.observed_count), 0), rows: modelRows },
      failedJobs: { sampleSize: failedRows.reduce((sum, row) => sum + number(row.count), 0), rows: failedRows },
      staleResearch: { sampleSize: number(staleRows[0]?.overdue_count), summary: staleRows[0] ?? {} },
    },
  };
  assertAggregateOnly(response);
  return response;
}