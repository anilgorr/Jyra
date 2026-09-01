---
name: Discovery provider identity evidence
description: Distinguishes provider trace identifiers from identity assertions during company discovery.
---

Generic provider result IDs are trace identifiers only. They must never be interpreted as proof that a result represents an organization. Organization typing requires an explicit normalized provider assertion; research-only discovery candidates must retain their lower-confidence identity state.

**Why:** Search providers can assign result IDs to arbitrary pages, products, services, or other non-company results. Treating ID presence as organization evidence can bypass identity safety.

**How to apply:** Keep discovery-candidate provenance separate from organization typing. Require independently consistent domain/source/name evidence and fail closed on ambiguity or conflict.