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
  `);
  console.log("Database invariants applied.");
} finally {
  await client.end();
}