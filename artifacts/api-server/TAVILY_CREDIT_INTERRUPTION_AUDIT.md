# Tavily Credit Interruption Audit

## Decision

**D — AUDIT INCONCLUSIVE**

## Frozen benchmark

- Original reported recall: **2/10 (20%)**
- Controls: **10**; frozen research questions: **40**
- Fully valid / partially invalid / fully invalid: **8 / 1 / 1**
- Pre-recovery valid-run recall: **1/8 (12.5%)**
- Invalid due to credits: **0**

## Safety and invariants

- Development database only; production operations: **0**.
- Frozen IDs were joined to provider usage, research jobs/questions/costs, evidence, proposals, facts, and signals.
- Health check ran only when persisted provider evidence proved a credit failure. Recovery ran only after a successful Tavily-routed health check.
- No labels were supplied to recovery, and no 50-company benchmark was rerun.

See the four JSON companion files for exact attempt rows, timestamps, joined IDs, sanitized errors, terminal/retry audit, recovery results, and costs.

## Executive metrics

- Total research questions: **40**
- Valid / invalid credit / rate limit / other provider error / timeout: **35 / 0 / 0 / 0 / 5**
- Fully valid / partially invalid / fully invalid controls: **8 / 1 / 1**
- Recovery required / executed / successful: **0 / 0 / 0**
- Post-recovery signals / precision: **2 / 1**
- Remaining misses: **8**; breakdown: {"QUERY_FAILURE":3,"FACT_EXTRACTION_FAILURE":3,"SIGNAL_MAPPING_FAILURE":1,"SOURCE_NOT_FOUND":1}
- Additional estimated / actual reported cost: **0 / NaN**
- Production operations: **0**
