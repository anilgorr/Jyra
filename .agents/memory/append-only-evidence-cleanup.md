---
name: Append-only evidence cleanup
description: How to handle rejected or incorrectly attributed evidence when immutable crawl payloads already exist.
---

Treat crawl payloads as append-only audit records. If attribution validation later rejects a result, remove or withhold its company-evidence link only after confirming no fact, proposal, or signal depends on it; do not rewrite or delete the crawl payload.

**Why:** The development database enforces crawl-page immutability with a trigger that blocks updates and deletes. Keeping rejected payloads outside the evidence graph preserves the audit trail without allowing them to support facts or signals.

**How to apply:** Validate entity attribution before creating evidence. For cleanup, check downstream provenance first, remove only the invalid evidence link, and leave the immutable raw payload unmodified.