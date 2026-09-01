---
name: Downstream replay idempotency
description: Replay validation must cover append-only downstream projections, not only stable research and opportunity identifiers.
---

Treat a full intelligence replay as non-idempotent when it preserves research jobs, signals, clusters, and base opportunities but appends semantically duplicate opportunity-history, WHY-version, or recommendation-ledger events. Serialize downstream decisions at the persisted opportunity-assessment boundary, and compare recommendation state to the current lifecycle tail rather than globally suppressing a fingerprint.

**Why:** A frozen end-to-end replay reused every research identifier and produced no new provider calls, yet each company received new downstream history, explanation, and recommendation records for an unchanged input state.

**How to apply:** For future replay checks, compare counts and canonical material snapshots across all downstream layers. Exclude execution timestamps, test both lock orders, and preserve genuine A→B→A transitions while suppressing unchanged retries.