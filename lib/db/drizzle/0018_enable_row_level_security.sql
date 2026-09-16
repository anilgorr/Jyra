-- Enable row-level security on every table in `public`.
--
-- What this is defending against. Supabase exposes PostgREST to the internet
-- with the publishable key; that key authenticates as `anon`. Until this week
-- `anon` held SELECT, INSERT, UPDATE, DELETE and TRUNCATE on all 83 tables and
-- RLS was off everywhere, so the key printed on the website returned live row
-- counts for every customer's companies, evidence and opportunities. The grants
-- have since been revoked, which closed it.
--
-- Revoking a grant is one line of SQL away from being undone - by a dashboard
-- click, a restore, a future `GRANT ... ON ALL TABLES`, or a Supabase feature
-- that re-grants on your behalf. RLS is the layer that still holds when that
-- happens: with RLS enabled and no policy, the answer to `anon` is zero rows
-- even WITH a grant. Two independent things must fail, not one.
--
-- Why this is safe for the API. It connects as `postgres`, which has
-- rolbypassrls = true, so RLS is not consulted for it at all - no policy is
-- needed for the application to keep working, and none is created here. This
-- is deliberately NOT `FORCE ROW LEVEL SECURITY`: forcing it would apply to the
-- owner too and would take the API down.
--
-- Tenant isolation continues to be enforced in the application, by the
-- organization scoping already present on every query. This migration does not
-- replace that and is not an argument for relaxing it. It closes the direct
-- PostgREST path, which the application layer never sees.
--
-- Written as a loop so it covers tables added later and is a no-op on re-run.

DO $$
DECLARE
  t record;
  enabled int := 0;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    enabled := enabled + 1;
  END LOOP;
  RAISE NOTICE 'row-level security enabled on % table(s)', enabled;
END $$;--> statement-breakpoint

-- Belt to the braces above: take the grants away again, in migration form, so a
-- fresh database never has them and a restored one loses them on next migrate.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
