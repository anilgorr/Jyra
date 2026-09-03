# Database Environment Safety

- Development schema push and invariant scripts require `DATABASE_URL`, refuse production/deployment runtime, and verify the connection target against the checked development-database fingerprint before connecting.
- Automated tests use the database supplied to the development workflow and must never be run with deployment credentials.
- Production deployments do not run schema push, invariant installation, development seeds, synthetic datasets, or demo imports.
- Production schema changes run only through the versioned migrations in `lib/db/drizzle/` via `pnpm --dir lib/db migrate` (see DATABASE.md, "Migration policy"). `drizzle-kit push` is development-only, and `push --force` requires an explicit `JYRA_CONFIRM_DESTRUCTIVE_PUSH=I_ACCEPT_DATA_LOSS` confirmation. Development data is never copied automatically.
- Database invariants (triggers, functions, guarded constraints) are part of the migration set (`0001_invariants.sql`) and are therefore installed in production, not only by the development `apply-invariants` helper.
- Test teardown that removes an organization or project owning a *frozen* Market Readiness campaign must run `SET LOCAL jyra.allow_frozen_teardown = 'on'` in the deleting transaction; without it the delete is rejected by design.
- Phase 23A tests create uniquely named records and remove them after assertions; they do not reset or truncate shared tables.
