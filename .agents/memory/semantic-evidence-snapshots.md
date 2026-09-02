---
name: Semantic evidence snapshots
description: Provenance and fingerprint rules for admitting derived company-intelligence snapshots into semantic assessment.
---

Derived assessment snapshots must never become independently citable evidence or recursively enter the fingerprint of the stage that created them. Unlinked derived claims are rejected; linked claims may enrich only their original admissible evidence IDs. Canonical entity records may be referenced directly only when labeled explicitly as canonical-record references rather than disguised as provenance rows.

**Why:** Allowing a Minimum Company Intelligence snapshot to cite its own row can bootstrap unsupported semantic evidence, and including prior snapshots in MCI inputs makes every replay generate a new fingerprint.

**How to apply:** Keep assessment snapshots out of upstream evidence builders and fingerprints. Preserve original evidence UUIDs for linked claims, reject claims without admissible links, and distinguish canonical record references from provenance-record citations.