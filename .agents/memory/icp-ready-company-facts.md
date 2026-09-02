---
name: ICP-ready company facts
description: Durable boundaries for projecting captured company evidence into WHO inputs.
---

WHO-facing company geography must come only from a typed, provenance-bound fact whose location role is eligible for the criterion. Customer markets, operating markets, offices, incorporation locations, and untyped locations must not become headquarters. Credible headquarters disagreements remain unresolved rather than using source precedence.

**Why:** Raw evidence can contain several distinct kinds of location, and legacy field precedence can silently turn an unrelated location into a confident ICP result or hide a real conflict.

**How to apply:** Reuse deterministic fact projections and their source IDs; keep country-only headquarters usable, preserve unknown/conflicted states, and let WHO consume the control plane's authoritative persisted CommercialRole instead of recomputing that seller-relative decision from prose.