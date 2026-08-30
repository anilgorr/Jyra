---
name: Evidence attribution reviews
description: Governance boundary between immutable provider payloads and mutable evidence-quality decisions.
---

Entity attribution, source classification, reliability, acceptance, and duplicate decisions belong in a review layer separate from immutable provider crawl payloads. A result may be stored for audit while remaining ineligible for fact extraction and signal evaluation.

**Why:** Search retrieval proves only that a result was returned. It does not prove the result belongs to the canonical company, is unique, or meets evidence-quality policy.

**How to apply:** Run entity verification and source classification before creating trusted evidence. Preserve rejected and duplicate payloads for audit, but gate fact and signal consumers on the persisted acceptance decision.