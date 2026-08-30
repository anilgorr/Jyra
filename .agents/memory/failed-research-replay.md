---
name: Failed research replay
description: How research idempotency should behave after provider configuration is repaired.
---

Failed provider attempts must remain auditable, but they must not be replayed forever after the provider becomes available. Give a failed attempt a deterministic retry identity while preserving replay for running, successful, and empty jobs.

**Why:** A persisted `NO_PROVIDER` result was returned after the provider had been repaired, making current Provider Diagnostics and live research appear inconsistent even though the router was never reached.

**How to apply:** When changing research execution or idempotency, verify that concurrent retries of one failed attempt collapse onto one retry job, while the original failure and the retry remain separate audit records.