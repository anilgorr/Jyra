---
name: Acceptance pack preflight
description: Durable rules for validating evolving frozen signal packs in acceptance harnesses.
---

Acceptance preflight must validate the selected active pack by stable pack identity, approval/activation state, required signal codes, versions, and semantic configuration. Do not equate definition count with correctness or research-question count.

**Why:** A validated fifth Managed SOC definition made a stale four-definition/four-question harness abort before intelligence execution. Older persisted definitions may omit empty configuration arrays that are semantically equivalent to explicit empty defaults.

**How to apply:** Query all definitions for the selected pack so unapproved required signals are diagnosable, normalize only semantically empty/default configuration fields, then pass approved definitions to the normal Research Planner without a harness-imposed count.