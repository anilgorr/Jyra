---
name: Global evidence review ownership
description: Why globally reusable evidence does not imply shared cross-tenant mutation authority.
---

Public evidence may be visible through any authorized project linked to the same canonical company, but only the organization that preserved an observation may change its global review status.

**Why:** Global reuse avoids duplicate source capture, while shared mutation authority would let an unrelated tenant mark another tenant's observation verified, conflicting, or stale.

**How to apply:** Keep reads rooted in project-company membership, derive preserving ownership server-side during ingestion, and require that same organization for later status transitions. Store tenant-specific interpretation elsewhere.