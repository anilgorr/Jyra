---
name: WHY provenance boundary
description: Non-obvious safeguards for evidence-backed narrative generation and versioning.
---

Forbidden buying-intent language must be authorized at the proposition level, not merely because source evidence belongs to the same broad category. Validate fact text, signal names, and signal descriptions independently against the evidence cited by that exact claim.

**Why:** Category matching can turn “has budget” into the stronger unsupported statement “budget approved,” or let an intent-bearing signal label bypass a neutral description check.

**How to apply:** Any future composer or LLM rewrite must either copy the supported source proposition or fall back to calibrated neutral language.

WHY source selection, composition, and version persistence must operate on one atomic snapshot, with bounded retry for serialization conflicts.

**Why:** Composing before the transaction can persist a current WHY from evidence that changed to stale or conflicting during generation.

**How to apply:** Lock/read source rows and persist claims within the same serializable transaction; preserve sequential immutable versions and exactly one current record.