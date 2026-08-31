---
name: Downstream replay idempotency
description: Replay validation must cover append-only downstream projections, not only stable research and opportunity identifiers.
---

Treat a full intelligence replay as non-idempotent when it preserves research jobs, signals, clusters, and base opportunities but appends semantically duplicate opportunity-history, WHY-version, or recommendation-ledger events.

**Why:** A frozen end-to-end replay reused every research identifier and produced no new provider calls, yet each company received new downstream history, explanation, and recommendation records for an unchanged input state.

**How to apply:** For future replay checks, compare counts and semantic input snapshots across research, evidence, facts, signals, clusters, base opportunities, opportunity history, WHY versions, and recommendation-ledger rows.