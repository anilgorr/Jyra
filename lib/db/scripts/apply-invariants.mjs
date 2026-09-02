import pg from "pg";
import { assertDevelopmentDatabase } from "./assert-development.mjs";

const databaseUrl = process.env.DATABASE_URL;
assertDevelopmentDatabase("Applying database invariants");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query(`
    CREATE OR REPLACE FUNCTION reject_crawl_page_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'crawl_pages records are append-only'
        USING ERRCODE = '55000';
    END;
    $$;

    DROP TRIGGER IF EXISTS crawl_pages_append_only ON crawl_pages;

    CREATE TRIGGER crawl_pages_append_only
    BEFORE UPDATE OR DELETE ON crawl_pages
    FOR EACH ROW
    EXECUTE FUNCTION reject_crawl_page_mutation();

    CREATE OR REPLACE FUNCTION require_signal_provenance()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      actual_fact_ids jsonb;
      actual_evidence_ids jsonb;
      paired_evidence_ids jsonb;
    BEGIN
      SELECT COALESCE(jsonb_agg(sf.fact_id ORDER BY sf.fact_id), '[]'::jsonb)
        INTO actual_fact_ids
        FROM signal_facts sf
        JOIN company_facts cf ON cf.id = sf.fact_id AND cf.company_id = sf.company_id
        WHERE sf.signal_id = NEW.id AND sf.company_id = NEW.company_id;

      SELECT COALESCE(jsonb_agg(se.evidence_id ORDER BY se.evidence_id), '[]'::jsonb)
        INTO actual_evidence_ids
        FROM signal_evidence se
        JOIN company_evidence ce ON ce.id = se.evidence_id AND ce.company_id = se.company_id
        WHERE se.signal_id = NEW.id AND se.company_id = NEW.company_id;

      SELECT COALESCE(jsonb_agg(DISTINCT cf.evidence_id ORDER BY cf.evidence_id), '[]'::jsonb)
        INTO paired_evidence_ids
        FROM signal_facts sf
        JOIN company_facts cf ON cf.id = sf.fact_id AND cf.company_id = sf.company_id
        JOIN signal_evidence se ON se.signal_id = sf.signal_id
          AND se.evidence_id = cf.evidence_id
          AND se.company_id = cf.company_id
        WHERE sf.signal_id = NEW.id AND sf.company_id = NEW.company_id;

      IF actual_fact_ids = '[]'::jsonb
         OR actual_evidence_ids = '[]'::jsonb
         OR actual_fact_ids <> NEW.supporting_fact_ids
         OR actual_evidence_ids <> NEW.supporting_evidence_ids
         OR actual_evidence_ids <> paired_evidence_ids THEN
        RAISE EXCEPTION 'signals require fact and evidence provenance'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS signals_require_provenance ON signals;
    CREATE CONSTRAINT TRIGGER signals_require_provenance
    AFTER INSERT OR UPDATE ON signals
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION require_signal_provenance();

    CREATE OR REPLACE FUNCTION require_linked_signal_provenance()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      parent_signal signals%ROWTYPE;
      actual_fact_ids jsonb;
      actual_evidence_ids jsonb;
      paired_evidence_ids jsonb;
    BEGIN
      SELECT * INTO parent_signal
        FROM signals
        WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.signal_id ELSE NEW.signal_id END;
      IF NOT FOUND THEN
        RETURN COALESCE(NEW, OLD);
      END IF;
      SELECT COALESCE(jsonb_agg(sf.fact_id ORDER BY sf.fact_id), '[]'::jsonb)
        INTO actual_fact_ids
        FROM signal_facts sf
        JOIN company_facts cf ON cf.id = sf.fact_id AND cf.company_id = sf.company_id
        WHERE sf.signal_id = parent_signal.id AND sf.company_id = parent_signal.company_id;
      SELECT COALESCE(jsonb_agg(se.evidence_id ORDER BY se.evidence_id), '[]'::jsonb)
        INTO actual_evidence_ids
        FROM signal_evidence se
        JOIN company_evidence ce ON ce.id = se.evidence_id AND ce.company_id = se.company_id
        WHERE se.signal_id = parent_signal.id AND se.company_id = parent_signal.company_id;
      SELECT COALESCE(jsonb_agg(DISTINCT cf.evidence_id ORDER BY cf.evidence_id), '[]'::jsonb)
        INTO paired_evidence_ids
        FROM signal_facts sf
        JOIN company_facts cf ON cf.id = sf.fact_id AND cf.company_id = sf.company_id
        JOIN signal_evidence se ON se.signal_id = sf.signal_id
          AND se.evidence_id = cf.evidence_id AND se.company_id = cf.company_id
        WHERE sf.signal_id = parent_signal.id AND sf.company_id = parent_signal.company_id;
      IF actual_fact_ids = '[]'::jsonb
         OR actual_evidence_ids = '[]'::jsonb
         OR actual_fact_ids <> parent_signal.supporting_fact_ids
         OR actual_evidence_ids <> parent_signal.supporting_evidence_ids
         OR actual_evidence_ids <> paired_evidence_ids THEN
        RAISE EXCEPTION 'signals require fact and evidence provenance'
          USING ERRCODE = '23514';
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$;

    DROP TRIGGER IF EXISTS signal_facts_preserve_provenance ON signal_facts;
    CREATE CONSTRAINT TRIGGER signal_facts_preserve_provenance
    AFTER INSERT OR UPDATE OR DELETE ON signal_facts
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION require_linked_signal_provenance();

    DROP TRIGGER IF EXISTS signal_evidence_preserve_provenance ON signal_evidence;
    CREATE CONSTRAINT TRIGGER signal_evidence_preserve_provenance
    AFTER INSERT OR UPDATE OR DELETE ON signal_evidence
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION require_linked_signal_provenance();

    CREATE OR REPLACE FUNCTION reject_signal_provenance_link_update()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'signal provenance links are immutable'
        USING ERRCODE = '55000';
    END;
    $$;

    DROP TRIGGER IF EXISTS signal_facts_immutable ON signal_facts;
    CREATE TRIGGER signal_facts_immutable
    BEFORE UPDATE ON signal_facts
    FOR EACH ROW
    EXECUTE FUNCTION reject_signal_provenance_link_update();

    DROP TRIGGER IF EXISTS signal_evidence_immutable ON signal_evidence;
    CREATE TRIGGER signal_evidence_immutable
    BEFORE UPDATE ON signal_evidence
    FOR EACH ROW
    EXECUTE FUNCTION reject_signal_provenance_link_update();

    CREATE UNIQUE INDEX IF NOT EXISTS opportunity_model_one_active_per_project
      ON opportunity_model_versions(project_id)
      WHERE active = true;

    CREATE UNIQUE INDEX IF NOT EXISTS why_explanations_one_current_per_opportunity
      ON why_explanations(opportunity_id)
      WHERE current = true;

    CREATE OR REPLACE FUNCTION protect_why_explanation_immutability()
    RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF OLD.current = true AND NEW.current = false
          AND (to_jsonb(NEW) - 'current') = (to_jsonb(OLD) - 'current') THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'WHY explanations are immutable except for retiring the current version';
      END IF;
      IF EXISTS (SELECT 1 FROM opportunities WHERE id = OLD.opportunity_id) THEN
        RAISE EXCEPTION 'WHY explanations may only be deleted with their parent opportunity';
      END IF;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS why_explanations_immutable ON why_explanations;
    CREATE TRIGGER why_explanations_immutable
      BEFORE UPDATE OR DELETE ON why_explanations
      FOR EACH ROW EXECUTE FUNCTION protect_why_explanation_immutability();

    CREATE OR REPLACE FUNCTION protect_why_claim_immutability()
    RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'WHY claims are immutable';
      END IF;
      IF EXISTS (SELECT 1 FROM why_explanations WHERE id = OLD.explanation_id) THEN
        RAISE EXCEPTION 'WHY claims may only be deleted with their parent explanation';
      END IF;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS why_claims_immutable ON why_claims;
    CREATE TRIGGER why_claims_immutable
      BEFORE UPDATE OR DELETE ON why_claims
      FOR EACH ROW EXECUTE FUNCTION protect_why_claim_immutability();

    CREATE OR REPLACE FUNCTION require_opportunity_scope_consistency()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM project_companies pc
        JOIN projects p ON p.id = pc.project_id
        JOIN opportunity_model_versions om
          ON om.id = NEW.model_version_id
         AND om.project_id = pc.project_id
         AND om.organization_id = p.organization_id
        WHERE pc.id = NEW.project_company_id
          AND pc.project_id = NEW.project_id
          AND pc.company_id = NEW.company_id
          AND p.organization_id = NEW.organization_id
      ) THEN
        RAISE EXCEPTION 'opportunity scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS opportunities_require_consistent_scope ON opportunities;
    CREATE TRIGGER opportunities_require_consistent_scope
    BEFORE INSERT OR UPDATE ON opportunities
    FOR EACH ROW
    EXECUTE FUNCTION require_opportunity_scope_consistency();

    CREATE OR REPLACE FUNCTION reject_recommendation_ledger_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'recommendation ledger records are immutable'
        USING ERRCODE = '55000';
    END;
    $$;

    DROP TRIGGER IF EXISTS recommendation_ledger_append_only ON recommendation_ledger;
    CREATE TRIGGER recommendation_ledger_append_only
    BEFORE UPDATE OR DELETE ON recommendation_ledger
    FOR EACH ROW
    EXECUTE FUNCTION reject_recommendation_ledger_mutation();

    DROP TRIGGER IF EXISTS recommendation_outcomes_append_only ON recommendation_outcomes;
    CREATE TRIGGER recommendation_outcomes_append_only
    BEFORE UPDATE OR DELETE ON recommendation_outcomes
    FOR EACH ROW
    EXECUTE FUNCTION reject_recommendation_ledger_mutation();

    CREATE OR REPLACE FUNCTION require_recommendation_ledger_scope()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM projects p
        JOIN project_companies pc ON pc.project_id = p.id
        WHERE p.id = NEW.project_id
          AND p.organization_id = NEW.organization_id
          AND pc.id = NEW.project_company_id
          AND pc.company_id = NEW.company_id
      ) THEN
        RAISE EXCEPTION 'recommendation ledger scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.opportunity_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM opportunities o
        WHERE o.id = NEW.opportunity_id
          AND o.organization_id = NEW.organization_id
          AND o.project_id = NEW.project_id
          AND o.project_company_id = NEW.project_company_id
          AND o.company_id = NEW.company_id
          AND o.model_version_id IS NOT DISTINCT FROM NEW.opportunity_model_version_id
          AND (o.input_snapshot ->> 'icpVersionId') IS NOT DISTINCT FROM NEW.icp_version_id::text
          AND (o.input_snapshot ->> 'intelligencePackVersionId') IS NOT DISTINCT FROM NEW.intelligence_pack_version_id::text
      ) THEN
        RAISE EXCEPTION 'recommendation opportunity scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.business_twin_version_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM business_twin_versions v
        JOIN business_twins b ON b.id = v.business_twin_id
        WHERE v.id = NEW.business_twin_version_id
          AND v.project_id = NEW.project_id
          AND b.organization_id = NEW.organization_id
      ) THEN
        RAISE EXCEPTION 'recommendation Business Twin scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.icp_version_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM icp_versions v
        JOIN icps i ON i.id = v.icp_id
        WHERE v.id = NEW.icp_version_id
          AND v.project_id = NEW.project_id
          AND i.organization_id = NEW.organization_id
          AND v.source_business_twin_version_id IS NOT DISTINCT FROM NEW.business_twin_version_id
      ) THEN
        RAISE EXCEPTION 'recommendation ICP scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.intelligence_pack_version_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM intelligence_pack_versions v
        JOIN intelligence_packs p ON p.id = v.intelligence_pack_id
        WHERE v.id = NEW.intelligence_pack_version_id
          AND p.project_id = NEW.project_id
          AND p.organization_id = NEW.organization_id
          AND v.source_icp_version_id IS NOT DISTINCT FROM NEW.icp_version_id
          AND v.source_business_twin_version_id IS NOT DISTINCT FROM NEW.business_twin_version_id
      ) THEN
        RAISE EXCEPTION 'recommendation Intelligence Pack scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.opportunity_model_version_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM opportunity_model_versions v
        WHERE v.id = NEW.opportunity_model_version_id
          AND v.project_id = NEW.project_id
          AND v.organization_id = NEW.organization_id
      ) THEN
        RAISE EXCEPTION 'recommendation Opportunity Model scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS recommendation_ledger_require_scope ON recommendation_ledger;
    CREATE TRIGGER recommendation_ledger_require_scope
    BEFORE INSERT ON recommendation_ledger
    FOR EACH ROW
    EXECUTE FUNCTION require_recommendation_ledger_scope();

    CREATE OR REPLACE FUNCTION require_recommendation_outcome_scope()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM recommendation_ledger r
        WHERE r.id = NEW.recommendation_id
          AND r.organization_id = NEW.organization_id
          AND r.project_id = NEW.project_id
          AND r.project_company_id = NEW.project_company_id
          AND r.company_id = NEW.company_id
      ) THEN
        RAISE EXCEPTION 'recommendation outcome scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS recommendation_outcomes_require_scope ON recommendation_outcomes;
    CREATE TRIGGER recommendation_outcomes_require_scope
    BEFORE INSERT ON recommendation_outcomes
    FOR EACH ROW
    EXECUTE FUNCTION require_recommendation_outcome_scope();

    CREATE OR REPLACE FUNCTION reject_learning_history_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'learning history is immutable'
        USING ERRCODE = '55000';
    END;
    $$;

    DROP TRIGGER IF EXISTS learning_policy_versions_append_only ON learning_policy_versions;
    CREATE TRIGGER learning_policy_versions_append_only
    BEFORE UPDATE OR DELETE ON learning_policy_versions
    FOR EACH ROW EXECUTE FUNCTION reject_learning_history_mutation();

    DROP TRIGGER IF EXISTS learning_metric_snapshots_append_only ON learning_metric_snapshots;
    CREATE TRIGGER learning_metric_snapshots_append_only
    BEFORE UPDATE OR DELETE ON learning_metric_snapshots
    FOR EACH ROW EXECUTE FUNCTION reject_learning_history_mutation();

    DROP TRIGGER IF EXISTS learning_model_versions_append_only ON learning_model_versions;
    CREATE TRIGGER learning_model_versions_append_only
    BEFORE UPDATE OR DELETE ON learning_model_versions
    FOR EACH ROW EXECUTE FUNCTION reject_learning_history_mutation();

    CREATE OR REPLACE FUNCTION require_learning_scope()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.scope = 'PROJECT' AND (
        NEW.project_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM projects p
          WHERE p.id = NEW.project_id AND p.organization_id = NEW.organization_id
        )
      ) THEN
        RAISE EXCEPTION 'project learning scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.scope <> 'PROJECT' AND NEW.project_id IS NOT NULL THEN
        RAISE EXCEPTION 'non-project learning scope cannot contain a project'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.scope = 'MARKET' AND NEW.intelligence_pack_version_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM intelligence_pack_versions v
        JOIN intelligence_packs p ON p.id = v.intelligence_pack_id
        WHERE v.id = NEW.intelligence_pack_version_id
          AND p.organization_id = NEW.organization_id
      ) THEN
        RAISE EXCEPTION 'market learning scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.scope = 'GLOBAL' AND (NEW.scope_key <> 'GLOBAL' OR NEW.intelligence_pack_version_id IS NOT NULL) THEN
        RAISE EXCEPTION 'global learning scope key is inconsistent' USING ERRCODE = '23514';
      END IF;
      IF NEW.scope = 'PROJECT' AND (NEW.scope_key <> 'PROJECT:' || NEW.project_id::text OR NEW.intelligence_pack_version_id IS NOT NULL) THEN
        RAISE EXCEPTION 'project learning scope key is inconsistent' USING ERRCODE = '23514';
      END IF;
      IF NEW.scope = 'MARKET' AND NEW.scope_key <> 'MARKET:' || COALESCE(NEW.intelligence_pack_version_id::text, 'ALL') THEN
        RAISE EXCEPTION 'market learning scope key is inconsistent' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS learning_policy_versions_require_scope ON learning_policy_versions;
    CREATE TRIGGER learning_policy_versions_require_scope
    BEFORE INSERT ON learning_policy_versions
    FOR EACH ROW EXECUTE FUNCTION require_learning_scope();

    DROP TRIGGER IF EXISTS learning_metric_snapshots_require_scope ON learning_metric_snapshots;
    CREATE TRIGGER learning_metric_snapshots_require_scope
    BEFORE INSERT ON learning_metric_snapshots
    FOR EACH ROW EXECUTE FUNCTION require_learning_scope();

    DROP TRIGGER IF EXISTS learning_proposals_require_scope ON learning_improvement_proposals;
    CREATE TRIGGER learning_proposals_require_scope
    BEFORE INSERT OR UPDATE ON learning_improvement_proposals
    FOR EACH ROW EXECUTE FUNCTION require_learning_scope();

    DROP TRIGGER IF EXISTS learning_model_versions_require_scope ON learning_model_versions;
    CREATE TRIGGER learning_model_versions_require_scope
    BEFORE INSERT ON learning_model_versions
    FOR EACH ROW EXECUTE FUNCTION require_learning_scope();

    CREATE OR REPLACE FUNCTION require_learning_model_source()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.source_proposal_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM learning_improvement_proposals p
        WHERE p.id = NEW.source_proposal_id
          AND p.organization_id = NEW.organization_id
          AND p.scope = NEW.scope
          AND p.scope_key = NEW.scope_key
          AND p.project_id IS NOT DISTINCT FROM NEW.project_id
          AND p.intelligence_pack_version_id IS NOT DISTINCT FROM NEW.intelligence_pack_version_id
      ) THEN
        RAISE EXCEPTION 'learning model source proposal scope is inconsistent' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;
    DROP TRIGGER IF EXISTS learning_model_versions_require_source ON learning_model_versions;
    CREATE TRIGGER learning_model_versions_require_source
    BEFORE INSERT ON learning_model_versions
    FOR EACH ROW EXECUTE FUNCTION require_learning_model_source();

    CREATE OR REPLACE FUNCTION require_learning_proposal_review()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'learning proposals cannot be deleted'
          USING ERRCODE = '55000';
      END IF;
      IF OLD.status <> 'PROPOSED'
         OR NEW.organization_id <> OLD.organization_id
         OR NEW.scope <> OLD.scope
         OR NEW.scope_key <> OLD.scope_key
         OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.intelligence_pack_version_id IS DISTINCT FROM OLD.intelligence_pack_version_id
         OR NEW.proposal_type <> OLD.proposal_type
         OR NEW.target_key <> OLD.target_key
         OR NEW.title <> OLD.title
         OR NEW.explanation <> OLD.explanation
         OR NEW.proposed_change <> OLD.proposed_change
         OR NEW.evidence_snapshot <> OLD.evidence_snapshot
         OR NEW.dedupe_key <> OLD.dedupe_key
         OR NEW.source_policy_version <> OLD.source_policy_version
         OR NEW.created_at <> OLD.created_at
         OR NEW.status NOT IN ('APPROVED', 'REJECTED')
         OR NEW.reviewed_by IS NULL
         OR NEW.reviewed_at IS NULL
         OR (NEW.status = 'APPROVED' AND NEW.approved_learning_version_id IS NULL)
         OR (NEW.status = 'REJECTED' AND NEW.approved_learning_version_id IS NOT NULL)
      THEN
        RAISE EXCEPTION 'learning proposal review is invalid'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS learning_proposals_review_only ON learning_improvement_proposals;
    CREATE TRIGGER learning_proposals_review_only
    BEFORE UPDATE OR DELETE ON learning_improvement_proposals
    FOR EACH ROW EXECUTE FUNCTION require_learning_proposal_review();

    CREATE OR REPLACE FUNCTION require_research_economics_scope()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM projects p
        JOIN project_companies pc
          ON pc.project_id = NEW.project_id
         AND pc.company_id = NEW.company_id
        WHERE p.id = NEW.project_id
          AND p.organization_id = NEW.organization_id
      ) THEN
        RAISE EXCEPTION 'research cost organization, project, and company scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.question_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM research_questions q
        WHERE q.id = NEW.question_id
          AND q.organization_id = NEW.organization_id
          AND q.project_id = NEW.project_id
          AND q.company_id = NEW.company_id
      ) THEN
        RAISE EXCEPTION 'research cost question scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.research_job_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM research_jobs j
        WHERE j.id = NEW.research_job_id
          AND j.organization_id = NEW.organization_id
          AND j.project_id = NEW.project_id
          AND j.company_id = NEW.company_id
          AND j.question_id IS NOT DISTINCT FROM NEW.question_id
      ) THEN
        RAISE EXCEPTION 'research cost job scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS research_request_costs_require_scope ON research_request_costs;
    CREATE TRIGGER research_request_costs_require_scope
    BEFORE INSERT ON research_request_costs
    FOR EACH ROW EXECUTE FUNCTION require_research_economics_scope();

    CREATE OR REPLACE FUNCTION reject_research_cost_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND NOT EXISTS (
        SELECT 1 FROM organizations o WHERE o.id = OLD.organization_id
      ) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'research request costs are append-only'
        USING ERRCODE = '55000';
    END;
    $$;

    DROP TRIGGER IF EXISTS research_request_costs_append_only ON research_request_costs;
    CREATE TRIGGER research_request_costs_append_only
    BEFORE UPDATE OR DELETE ON research_request_costs
    FOR EACH ROW EXECUTE FUNCTION reject_research_cost_mutation();

    CREATE OR REPLACE FUNCTION require_research_budget_scope()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = NEW.project_id
          AND p.organization_id = NEW.organization_id
      ) THEN
        RAISE EXCEPTION 'research budget organization and project scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS research_budgets_require_scope ON research_budgets;
    CREATE TRIGGER research_budgets_require_scope
    BEFORE INSERT OR UPDATE ON research_budgets
    FOR EACH ROW EXECUTE FUNCTION require_research_budget_scope();

    CREATE OR REPLACE FUNCTION require_research_reservation_scope()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM projects p
        JOIN project_companies pc
          ON pc.project_id = NEW.project_id
         AND pc.company_id = NEW.company_id
        WHERE p.id = NEW.project_id
          AND p.organization_id = NEW.organization_id
      ) THEN
        RAISE EXCEPTION 'research reservation organization, project, and company scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS research_budget_reservations_require_scope ON research_budget_reservations;
    CREATE TRIGGER research_budget_reservations_require_scope
    BEFORE INSERT OR UPDATE ON research_budget_reservations
    FOR EACH ROW EXECUTE FUNCTION require_research_reservation_scope();

    CREATE OR REPLACE FUNCTION require_company_provenance_scope()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM projects p
        JOIN project_companies pc
          ON pc.project_id = NEW.project_id
         AND pc.company_id = NEW.company_id
        WHERE p.id = NEW.project_id
          AND p.organization_id = NEW.organization_id
      ) THEN
        RAISE EXCEPTION 'company provenance organization, project, and company scope is inconsistent'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS company_provenance_require_scope ON company_provenance;
    CREATE TRIGGER company_provenance_require_scope
    BEFORE INSERT ON company_provenance
    FOR EACH ROW EXECUTE FUNCTION require_company_provenance_scope();

    CREATE OR REPLACE FUNCTION reject_company_provenance_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'company provenance is immutable'
        USING ERRCODE = '55000';
    END;
    $$;

    DROP TRIGGER IF EXISTS company_provenance_immutable ON company_provenance;
    CREATE TRIGGER company_provenance_immutable
    BEFORE UPDATE OR DELETE ON company_provenance
    FOR EACH ROW EXECUTE FUNCTION reject_company_provenance_mutation();

    -- Market Readiness carries redundant scope columns for query isolation.
    -- These checks are database-side because direct/concurrent writers could
    -- otherwise attach an item or assignment from another campaign.
    CREATE OR REPLACE FUNCTION require_market_readiness_scope()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM market_readiness_campaigns c
        WHERE c.id = NEW.campaign_id AND c.organization_id = NEW.organization_id
          AND c.project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'market readiness campaign scope is inconsistent' USING ERRCODE = '23514';
      END IF;
      IF TG_TABLE_NAME IN ('market_readiness_blind_gold_reviews','market_readiness_adjudications',
        'market_readiness_salesperson_reviews','market_readiness_manual_outcomes',
        'market_readiness_prediction_snapshots','market_readiness_experiment_assignments') THEN
        IF NOT EXISTS (
          SELECT 1 FROM market_readiness_cohort_items i WHERE i.id = NEW.cohort_item_id
            AND i.campaign_id = NEW.campaign_id AND i.organization_id = NEW.organization_id AND i.project_id = NEW.project_id
        ) THEN
          RAISE EXCEPTION 'market readiness cohort item scope is inconsistent' USING ERRCODE = '23514';
        END IF;
      END IF;
      IF TG_TABLE_NAME = 'market_readiness_manual_outcomes' THEN
        IF NEW.experiment_assignment_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM market_readiness_experiment_assignments a WHERE a.id = NEW.experiment_assignment_id
            AND a.campaign_id = NEW.campaign_id AND a.cohort_item_id = NEW.cohort_item_id
            AND a.organization_id = NEW.organization_id AND a.project_id = NEW.project_id
        ) THEN
          RAISE EXCEPTION 'market readiness outcome assignment scope is inconsistent' USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (
          SELECT 1
          FROM market_readiness_experiment_assignments a
          JOIN market_readiness_experiments e ON e.id = a.experiment_id
          WHERE a.id = NEW.experiment_assignment_id
            AND e.state IN ('RUNNING', 'COMPLETED')
            AND e.started_at IS NOT NULL
            AND NEW.occurred_at >= e.started_at
        ) THEN
          RAISE EXCEPTION 'market readiness outcome must occur after experiment start' USING ERRCODE = '23514';
        END IF;
      END IF;
      IF TG_TABLE_NAME = 'market_readiness_prediction_snapshots' THEN
        IF NOT EXISTS (
          SELECT 1 FROM market_readiness_processing_attempts a WHERE a.id = NEW.processing_attempt_id
            AND a.campaign_id = NEW.campaign_id AND a.cohort_item_id = NEW.cohort_item_id
            AND a.organization_id = NEW.organization_id AND a.project_id = NEW.project_id
            AND a.state = 'SUCCEEDED'
            AND a.spent_cents = (NEW.predictions ->> 'totalCostCents')::integer
        ) THEN
          RAISE EXCEPTION 'market readiness prediction attempt must be matching, succeeded, and exact-cost' USING ERRCODE = '23514';
        END IF;
      END IF;
      IF TG_TABLE_NAME = 'market_readiness_experiment_assignments' THEN
        IF NOT EXISTS (
          SELECT 1 FROM market_readiness_experiments e WHERE e.id = NEW.experiment_id
            AND e.campaign_id = NEW.campaign_id AND e.organization_id = NEW.organization_id
            AND e.project_id = NEW.project_id
        ) THEN
          RAISE EXCEPTION 'market readiness experiment scope is inconsistent' USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NEW;
    END; $$;
    CREATE OR REPLACE FUNCTION reject_market_readiness_late_write()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE campaign_frozen_at timestamptz;
    BEGIN
      -- This row lock is compatible with other child writers but conflicts
      -- with freeze's FOR UPDATE lock, closing the check/insert race.
      SELECT c.frozen_at INTO campaign_frozen_at
        FROM market_readiness_campaigns c
        WHERE c.id = NEW.campaign_id
        FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'market readiness campaign does not exist' USING ERRCODE = '23503';
      END IF;
      IF campaign_frozen_at IS NOT NULL THEN
        RAISE EXCEPTION 'market readiness campaign is frozen' USING ERRCODE = '55000';
      END IF; RETURN NEW;
    END; $$;
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['market_readiness_cohort_items','market_readiness_blind_gold_reviews','market_readiness_adjudications','market_readiness_salesperson_reviews','market_readiness_manual_outcomes','market_readiness_prediction_snapshots'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_require_scope', t);
        EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION require_market_readiness_scope()', t || '_require_scope', t);
      END LOOP;
      FOREACH t IN ARRAY ARRAY['market_readiness_cohort_items','market_readiness_blind_gold_reviews','market_readiness_adjudications','market_readiness_salesperson_reviews','market_readiness_prediction_snapshots'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_freeze_writes', t);
        EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION reject_market_readiness_late_write()', t || '_freeze_writes', t);
      END LOOP;
    END $$;
    -- Remove a legacy shared trigger from tables that do not expose
    -- cohort_item_id. Their scope is enforced by their dedicated service
    -- transaction and foreign keys; leaving this trigger attached makes
    -- PostgreSQL resolve a field that does not exist on NEW.
    DROP TRIGGER IF EXISTS market_readiness_processing_attempts_require_scope
      ON market_readiness_processing_attempts;
    DROP TRIGGER IF EXISTS market_readiness_manual_outcomes_freeze_writes ON market_readiness_manual_outcomes;
    CREATE UNIQUE INDEX IF NOT EXISTS market_readiness_prediction_campaign_item_unique
      ON market_readiness_prediction_snapshots(campaign_id, cohort_item_id);
    CREATE OR REPLACE FUNCTION require_complete_market_readiness_prediction()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE key_count integer;
    BEGIN
      SELECT count(*) INTO key_count FROM jsonb_object_keys(NEW.predictions);
      IF jsonb_typeof(NEW.predictions) <> 'object' OR key_count <> 21 OR NOT (
        NEW.predictions ?& ARRAY['identityResolved','predictedRole','predictedWho','predictedBuyer',
          'predictedCompetitor','evidenceBacked','unsupportedFactsCount',
          'unsupportedFacts','processingSucceeded','terminalState','providerCostCents','semanticCostCents',
          'totalCostCents','model','intelligenceVersion','profileFingerprint','assessmentFingerprint',
          'inputFingerprint','businessTwinVersion','offeringVersion','icpVersion']
      ) OR EXISTS (
        SELECT 1 FROM unnest(ARRAY['identityResolved','predictedRole','predictedWho','predictedBuyer',
          'predictedCompetitor','evidenceBacked','unsupportedFacts',
          'processingSucceeded']) k
        WHERE jsonb_typeof(NEW.predictions -> k) <> 'boolean'
      ) OR EXISTS (
        SELECT 1 FROM unnest(ARRAY['unsupportedFactsCount','providerCostCents','semanticCostCents','totalCostCents']) k
        WHERE jsonb_typeof(NEW.predictions -> k) <> 'number'
          OR (NEW.predictions ->> k) !~ '^[0-9]+$'
      ) OR EXISTS (
        SELECT 1 FROM unnest(ARRAY['terminalState','model','intelligenceVersion','profileFingerprint',
          'assessmentFingerprint','inputFingerprint','businessTwinVersion','offeringVersion','icpVersion']) k
        WHERE jsonb_typeof(NEW.predictions -> k) <> 'string' OR NEW.predictions ->> k = ''
      ) OR (NEW.predictions ->> 'unsupportedFacts')::boolean <>
        ((NEW.predictions ->> 'unsupportedFactsCount')::integer > 0)
        OR NEW.predictions ->> 'terminalState' NOT IN ('SEMANTIC_ASSESSMENT','COMMERCIAL_ROLE_EXCLUSION',
          'MANDATORY_CRITERION_FAILURE','IDENTITY_UNCERTAIN','EVIDENCELESS_POSITIVE_BLOCKED')
        OR NEW.version <> NEW.predictions ->> 'intelligenceVersion'
        OR (NEW.predictions ->> 'totalCostCents')::integer <>
          (NEW.predictions ->> 'providerCostCents')::integer + (NEW.predictions ->> 'semanticCostCents')::integer
      THEN
        RAISE EXCEPTION 'market readiness prediction evaluation is incomplete or invalid' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END; $$;
    DROP TRIGGER IF EXISTS market_readiness_prediction_snapshots_require_complete_evaluation ON market_readiness_prediction_snapshots;
    CREATE TRIGGER market_readiness_prediction_snapshots_require_complete_evaluation
      BEFORE INSERT ON market_readiness_prediction_snapshots
      FOR EACH ROW EXECUTE FUNCTION require_complete_market_readiness_prediction();
    ALTER TABLE market_readiness_prediction_snapshots
      ALTER COLUMN processing_attempt_id SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS market_readiness_experiment_campaign_unique
      ON market_readiness_experiments(campaign_id);
    CREATE OR REPLACE FUNCTION enforce_market_readiness_experiment_timestamps()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN
        RAISE EXCEPTION 'market readiness experiment start is immutable' USING ERRCODE = '55000';
      END IF;
      IF OLD.started_at IS NULL AND NEW.started_at IS NOT NULL
         AND NOT (OLD.state = 'ASSIGNED' AND NEW.state = 'RUNNING') THEN
        RAISE EXCEPTION 'market readiness experiment start transition is invalid' USING ERRCODE = '23514';
      END IF;
      IF NEW.state IN ('RUNNING', 'COMPLETED') AND NEW.started_at IS NULL THEN
        RAISE EXCEPTION 'market readiness running experiment requires start time' USING ERRCODE = '23514';
      END IF;
      IF OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
        RAISE EXCEPTION 'market readiness experiment completion is immutable' USING ERRCODE = '55000';
      END IF;
      IF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
         AND NOT (OLD.state = 'RUNNING' AND NEW.state = 'COMPLETED' AND NEW.completed_at >= NEW.started_at) THEN
        RAISE EXCEPTION 'market readiness experiment completion transition is invalid' USING ERRCODE = '23514';
      END IF;
      IF NEW.state = 'COMPLETED' AND NEW.completed_at IS NULL THEN
        RAISE EXCEPTION 'market readiness completed experiment requires completion time' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END; $$;
    DROP TRIGGER IF EXISTS market_readiness_experiments_enforce_timestamps ON market_readiness_experiments;
    CREATE TRIGGER market_readiness_experiments_enforce_timestamps
      BEFORE UPDATE ON market_readiness_experiments
      FOR EACH ROW EXECUTE FUNCTION enforce_market_readiness_experiment_timestamps();
    ALTER TABLE market_readiness_manual_outcomes
      ALTER COLUMN experiment_assignment_id SET NOT NULL;
    CREATE OR REPLACE FUNCTION reject_market_readiness_prediction_snapshot_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'market readiness prediction snapshots are immutable' USING ERRCODE = '55000';
    END; $$;
    DROP TRIGGER IF EXISTS market_readiness_prediction_snapshots_append_only ON market_readiness_prediction_snapshots;
    CREATE TRIGGER market_readiness_prediction_snapshots_append_only
      BEFORE UPDATE OR DELETE ON market_readiness_prediction_snapshots
      FOR EACH ROW EXECUTE FUNCTION reject_market_readiness_prediction_snapshot_mutation();
    ALTER TABLE market_readiness_campaigns DROP CONSTRAINT IF EXISTS market_readiness_campaign_hard_cap;
    ALTER TABLE market_readiness_campaigns DROP CONSTRAINT IF EXISTS market_readiness_campaign_target_positive;
    ALTER TABLE market_readiness_campaigns ADD CONSTRAINT market_readiness_campaign_target_exactly_200 CHECK (target_count = 200);
  `);
  console.log("Database invariants applied.");
} finally {
  await client.end();
}