---
name: Stored profile trust
description: Trust boundary between stored company-profile identifiers and downstream enrichment.
---

A syntactically valid profile URL stored on a canonical company is still unverified unless durable resolver or user-verification provenance supports that exact identifier.

**Why:** Stale, imported, or incorrectly attached identifiers can otherwise unlock expensive downstream enrichment for the wrong entity.

**How to apply:** Before identifier-dependent enrichment, verify the exact stored identifier through provenance or resolve it again; unresolved or ambiguous outcomes must block the downstream provider.