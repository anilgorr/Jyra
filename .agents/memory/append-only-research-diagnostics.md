---
name: Append-only research diagnostics
description: How to persist provider-attempt diagnostics when research economics rows are immutable.
---

Provider-attempt usage and retrieval assessment metadata must be assembled before the request-cost record is inserted. Do not insert preliminary usage and update the row after sufficiency or fallback assessment.

**Why:** Research economics records are append-only. Post-request enrichment violates the database invariant and can make otherwise successful live research fail only after the provider calls have completed.

**How to apply:** Buffer bounded provider-attempt observations in memory for the duration of one research job, join them to the final assessment by request ID, then insert each immutable attempt exactly once before downstream evidence processing.