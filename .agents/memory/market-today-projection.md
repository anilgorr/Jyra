---
name: Market Today projection
description: Durable rules for deriving the project-scoped WHO, WHEN, WHY landing view.
---

The market landing view is a read-only projection over persisted Opportunity assessments, immutable history, current WHY, signals, clusters, evidence, and research state. Reading it must never trigger scoring or research.

**Why:** A dashboard read must be reproducible and safe. Strong canonical states with incomplete assessments or insufficient WHY support would otherwise create a misleading attention count.

**How to apply:** Put unsupported or unassessed companies exclusively in Needs Research, derive movement from immutable history, preserve canonical state labels, and use deterministic tie-breakers when persisted timestamps or strengths are equal.