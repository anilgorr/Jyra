import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply database invariants");
}

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
  `);
  console.log("Database invariants applied.");
} finally {
  await client.end();
}