---
name: Blind retrieval bake-offs
description: How to interpret provider comparisons when generic query formulation changes retrieval coverage.
---

Freeze the control population first, keep queries blind to the known event, recursively redact retained payloads, and preserve raw provider output separately from post-retrieval adjudication. Do not interpret a provider tie as evidence for changing production routing.

**Why:** Provider comparisons become misleading when query quality differs, and raw search content can itself contain credential-bearing URLs even when request credentials are removed.

**How to apply:** Before integrating another provider, compare equivalent blind query variants, report per-control evidence and cost completeness, recursively redact payloads, and require provider-exclusive coverage or another clear advantage.