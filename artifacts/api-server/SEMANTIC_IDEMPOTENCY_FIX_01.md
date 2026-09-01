# Semantic Idempotency Fix 01

**A — DOWNSTREAM SEMANTIC IDEMPOTENCY VALIDATED**

## Required summary

- BEFORE duplicate opportunity history: **10**
- BEFORE duplicate WHY versions: **10**
- BEFORE duplicate recommendations: **10**
- Opportunity history root cause: No current-state semantic change detection before append.
- WHY root cause: A new version was created whenever generation ran.
- Recommendation root cause: Global state-fingerprint uniqueness prevented a material state from recurring after an intervening state.
- Opportunity semantic fingerprint: Allowlisted material opportunity, dimensions, signals, clusters, evidence quality, and score components.
- WHY semantic fingerprint: Allowlisted structured status, rule, claims, and supporting references.
- Recommendation semantic fingerprint: Allowlisted base recommendation state plus deterministic prior-chain transition key for append-only lifecycle recurrence.
- Volatile timestamp fields excluded: **opportunityAssessedAt, evidenceReferences.observedAt, createdAt, updatedAt, retrievedAt**
- Concurrency protection: Per-opportunity transaction advisory lock; row-locked serializable WHY compare; atomic recommendation unique conflict handling.
- AFTER EXACT REPLAY new provider calls: **0**
- AFTER EXACT REPLAY new opportunity history: **0**
- AFTER EXACT REPLAY new WHY versions: **0**
- AFTER EXACT REPLAY new recommendation records: **0**
- Duplicate companies / evidence / facts / signals: **0 / 0 / 0 / 0**
- Real material change detected and preserved: **YES**
- Correct history / WHY / recommendation behavior: **YES / YES / YES**
- Timestamp-only new semantic records: **0**
- Retry duplicate semantic records: **0**
- A to B to A history preserved: **YES**
- Production operations: **0**
