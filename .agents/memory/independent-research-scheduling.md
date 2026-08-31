---
name: Independent research scheduling
description: Scheduling and row-reuse invariants for explicit multi-question signal-pack research.
---

Explicitly planned research questions are independent and must not inherit another question type's company-level refresh stop. When refreshing a matching terminal question, preserve its terminal status while the new job is running rather than moving it back to an in-progress status.

**Why:** A company-wide latest-question gate deferred unrelated signal areas, while terminal-to-in-progress transitions collided with status-aware question uniqueness when interrupted rows existed.

**How to apply:** Ordinary planner refreshes may use company-level due dates. Explicit pack questions must use their own idempotency, matching question-type reuse, budget decision, provider decision, and terminal disposition; stale running jobs may be retried only after a bounded age.