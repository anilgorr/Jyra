-- Pin `search_path` on every function in `public` that does not declare one.
--
-- A function without a pinned search_path resolves unqualified names against
-- whatever the CALLER's search_path happens to be. Someone able to create a
-- schema earlier in that path can shadow a table or an operator and have the
-- function operate on their object instead of ours. All 27 of these are the
-- invariant triggers - the code that refuses a crawl-page mutation, a late
-- market-readiness write, a WHY claim edit - so they are exactly the functions
-- whose behaviour must not depend on who called them.
--
-- `0001_invariants.sql` now declares SET search_path on each definition, which
-- covers fresh databases and the dev helper that re-applies that file directly.
-- It does NOT cover this one: the migrator applies journal entries by
-- timestamp, so an edit to an already-applied migration is never re-run. Hence
-- both - the definition for databases yet to be built, and this for the one in
-- production.
--
-- Written as a loop rather than 27 ALTER statements so it also catches any
-- function added later that forgets, and so re-running it is a no-op.

DO $$
DECLARE
  fn record;
  pinned int := 0;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', fn.signature);
    pinned := pinned + 1;
  END LOOP;
  RAISE NOTICE 'pinned search_path on % function(s)', pinned;
END $$;
