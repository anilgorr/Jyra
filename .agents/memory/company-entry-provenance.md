---
name: Company entry provenance
description: Privacy and trust boundary when canonical companies are reached through private import or public discovery.
---

Global canonical company records contain identity only. Private imported attributes and unvalidated provider descriptions stay in project-scoped provenance until the evidence/fact pipeline validates them. URLs hosted by company-profile platforms are identifiers and source observations, never canonical company domains.

**Why:** A globally reused canonical row can cross tenant boundaries, while scraped or uploaded descriptive fields are not verified facts. A LinkedIn, Crunchbase, or similar profile identifies a company but does not establish ownership of that platform's hostname.

**How to apply:** Every company entry path may reuse canonical identity, but must preserve its own scoped source observation and must not promote descriptive source content into global canonical state. Classify known platform URLs into profile fields, preserve the original URL in provenance, and leave domain unknown until bounded resolution verifies a non-platform domain.