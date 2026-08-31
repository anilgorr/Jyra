---
name: Blind retrieval bake-offs
description: How to interpret provider comparisons when generic query formulation changes retrieval coverage.
---

Freeze the control population first, keep queries blind to the known event, recursively redact retained payloads, and preserve raw provider output separately from post-retrieval adjudication. A controlled cross-provider fallback validation may prove resilience, but it does not authorize changing permanent production routing.

**Why:** Provider comparisons become misleading when query quality differs, raw search content can itself contain credential-bearing URLs even when request credentials are removed, and a successful experimental fallback still needs separate human approval before production integration.

**How to apply:** Before integrating another provider, compare equivalent blind query variants, report per-control evidence and cost completeness, recursively redact payloads, test repeatability, and keep experimental fallback code isolated until a separate routing milestone is approved.