---
name: Signal provenance invariants
description: Durable integrity rules for project-specific signals and their public evidence support.
---

Signal provenance must be an exact snapshot: normalized fact links, normalized evidence links, and response IDs must agree; each fact's own evidence must be linked; all rows must belong to the same canonical company. Link rows are immutable, and deleting links from a surviving signal must fail. Re-evaluation may atomically replace the complete snapshot.

**Why:** Checking only for non-empty support, or validating only signal inserts, leaves gaps for forged IDs, mismatched evidence, post-commit link deletion, link moves, and later evidence additions.

**How to apply:** Any new signal writer must use one transaction for the signal snapshot and links. Any schema change must preserve deferred validation on both the parent signal and every link-table mutation.