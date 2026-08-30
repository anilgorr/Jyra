# Database Environment Safety

- Development schema push and invariant scripts require `DATABASE_URL`, refuse production/deployment runtime, and verify the connection target against the checked development-database fingerprint before connecting.
- Automated tests use the database supplied to the development workflow and must never be run with deployment credentials.
- Production deployments do not run schema push, invariant installation, development seeds, synthetic datasets, or demo imports.
- Production schema changes require an explicit controlled production migration workflow. Development data is never copied automatically.
- Phase 23A tests create uniquely named records and remove them after assertions; they do not reset or truncate shared tables.
