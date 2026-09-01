# MVP 10-Control Acceptance Test 02 — Failures

## Failure summary

All ten controls failed first at `IDENTITY`. Each Exa `COMPANY_DISCOVERY` call completed successfully and returned raw results, but normal canonicalization returned 0 and the control ended `NOT_PROVISIONED`. Identity state is `UNRESOLVED`; confidence was not established; no auto-attachment occurred. These are `INVALID_RUN` outcomes, not misses.

1. **SolarWinds** — 10 raw results; canonicalized 0; `NOT_PROVISIONED`; `IDENTITY`.
2. **First Horizon** — 10 raw results; canonicalized 0; `NOT_PROVISIONED`; `IDENTITY`.
3. **GitLab** — 10 raw results; canonicalized 0; `NOT_PROVISIONED`; `IDENTITY`.
4. **Infoblox** — 10 raw results; canonicalized 0; `NOT_PROVISIONED`; `IDENTITY`.
5. **Teradata** — 10 raw results; canonicalized 0; `NOT_PROVISIONED`; `IDENTITY`.
6. **Nubank** — 10 raw results; canonicalized 0; `NOT_PROVISIONED`; `IDENTITY`.
7. **Black Duck** — 10 raw results; canonicalized 0; `NOT_PROVISIONED`; `IDENTITY`.
8. **OpenAssets** — 1 raw result; canonicalized 0; `NOT_PROVISIONED`; `IDENTITY`.
9. **Black & McDonald** — 9 raw results; canonicalized 0; `NOT_PROVISIONED`; `IDENTITY`.
10. **RAKBANK** — 10 raw results; canonicalized 0; `NOT_PROVISIONED`; `IDENTITY`.

Provider failures: 0. No downstream research, evidence, facts, signals, WHY, opportunity, or NBA ran.

Per the frozen STOP/do-not-fix instruction, this artifact contains no fix or implementation recommendation. The next human review target is the normal identity canonicalization/provisioning path.