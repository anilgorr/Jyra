---
name: Signal context revisions
description: Preserving historical signal meaning when seller context or pack configuration changes.
---

Signal identity must incorporate the selected pack revision as well as pack and definition versions. Changing an offering, Business Twin/ICP snapshot, or project-level pack override creates a new contextual signal revision rather than rewriting a signal produced under the old seller context.

**Why:** The same source-grounded fact can mean different things under different seller contexts. Reusing the old signal identity would overwrite historical commercial interpretation even if exact evidence provenance remained valid.

**How to apply:** Same-context re-evaluation may atomically replace the complete provenance snapshot, but any project-pack selection update must change rule identity and preserve older contextual signal rows.