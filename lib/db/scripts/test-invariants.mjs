import assert from "node:assert/strict";
import pg from "pg";
import { assertDevelopmentDatabase } from "./assert-development.mjs";

const databaseUrl = process.env.DATABASE_URL;
assertDevelopmentDatabase("Database invariant tests");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const trigger = await client.query(`
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'crawl_pages_append_only'
      AND tgenabled <> 'D'
      AND NOT tgisinternal
  `);
  assert.equal(trigger.rowCount, 1, "append-only crawl trigger must exist");

  const opportunityScopeTrigger = await client.query(`
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'opportunities_require_consistent_scope'
      AND tgenabled <> 'D' AND NOT tgisinternal
  `);
  assert.equal(opportunityScopeTrigger.rowCount, 1, "opportunity scope consistency trigger must exist");

  const activeModelIndex = await client.query(`
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'opportunity_model_one_active_per_project'
  `);
  assert.equal(activeModelIndex.rowCount, 1, "one-active-opportunity-model index must exist");

  const currentWhyIndex = await client.query(`
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'why_explanations_one_current_per_opportunity'
  `);
  assert.equal(currentWhyIndex.rowCount, 1, "one-current-WHY index must exist");

  const whyTriggers = await client.query(`
    SELECT tgname FROM pg_trigger
    WHERE tgname IN ('why_explanations_immutable', 'why_claims_immutable') AND NOT tgisinternal
  `);
  assert.equal(whyTriggers.rowCount, 2, "WHY explanation and claim immutability triggers must exist");

  const learningTriggers = await client.query(`
    SELECT tgname FROM pg_trigger
    WHERE tgname IN (
      'learning_policy_versions_append_only',
      'learning_metric_snapshots_append_only',
      'learning_model_versions_append_only',
      'learning_policy_versions_require_scope',
      'learning_proposals_review_only'
    ) AND tgenabled <> 'D' AND NOT tgisinternal
  `);
  assert.equal(learningTriggers.rowCount, 5, "learning immutability, scope, and review triggers must exist");

  const researchEconomicsTriggers = await client.query(`
    SELECT tgname FROM pg_trigger
    WHERE tgname IN (
      'research_request_costs_append_only',
      'research_request_costs_require_scope',
      'research_budgets_require_scope',
      'research_budget_reservations_require_scope'
    ) AND tgenabled <> 'D' AND NOT tgisinternal
  `);
  assert.equal(researchEconomicsTriggers.rowCount, 4, "research economics append-only and scope triggers must exist");

  const companyProvenanceTriggers = await client.query(`
    SELECT tgname FROM pg_trigger
    WHERE tgname IN ('company_provenance_require_scope', 'company_provenance_immutable')
      AND tgenabled <> 'D' AND NOT tgisinternal
  `);
  assert.equal(companyProvenanceTriggers.rowCount, 2, "company provenance scope and immutability triggers must exist");

  const capture = await client.query(
    "SELECT id, raw_content FROM crawl_pages ORDER BY created_at LIMIT 1",
  );
  if (capture.rowCount > 0) {
    await assert.rejects(
      client.query(
        "UPDATE crawl_pages SET raw_content = raw_content WHERE id = $1",
        [capture.rows[0].id],
      ),
      (error) =>
        error?.code === "55000" &&
        /append-only/.test(String(error.message)),
    );
  }

  console.log("Database invariant tests passed.");
} finally {
  await client.end();
}