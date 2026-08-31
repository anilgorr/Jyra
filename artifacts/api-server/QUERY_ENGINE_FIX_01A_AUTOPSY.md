# Query Engine Fix 01A — Reproduction Autopsy

## Result

- Black & McDonald event retrieved: **NO**
- RAKBANK event retrieved: **NO**
- Combined events retrieved: **0/2**
- Tavily calls: **4**
- Wrong entity accepted: **0**
- Seller content accepted: **0**
- Production operations: **0**

## Differential conclusion

- **Black & McDonald:** the failed normal primary used the canonical legal name “Black & McDonald Limited”; the successful bake-off used the generic display identity “Black & McDonald”. This is query-generation drift.
- **RAKBANK:** the validated primary query and request parameters were identical, but the failed run's fallback had drifted from the validated successful fallback. After restoring the exact validated fallback, Tavily still returned a materially different URL set.
- **Cache:** no retrieval cache exists in the normal adaptive WEB_SEARCH path, so stale-cache reuse was not involved.
- **Post-retrieval filters:** neither missing event URL appeared in the failed raw result set, so deduplication, entity, relevance, and temporal filtering did not drop the events.

## Minimal generic fix

1. Strip common legal suffixes from the quoted search identity while retaining the verified canonical domain.
2. Restore the validated generic fallback semantics exactly.
3. Keep the existing two-call limit and provider-failure fallback prohibition.

## Final decision

**C — PROVIDER RESULT VARIABILITY PREVENTS DETERMINISTIC REPRODUCTION**
