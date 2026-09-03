---
name: Model citation abstention
description: Distinguishes repairable model citation mistakes from corruption of immutable evidence.
---

Known invalid citations produced by a fresh model response should remove support only from the affected claim and force an evidence-free unknown/abstention. Corrupt immutable evidence or cached citation state remains a strict failure.

**Why:** A model can emit a wrong-type or unknown citation without making the preserved source snapshot untrustworthy. Broadly rejecting fresh output wastes recoverable work, but normalizing damaged persisted evidence would hide audit corruption.

**How to apply:** Normalize fresh response citations before persistence, never bind unknown IDs, and abstain at the narrowest affected section. Reject duplicate, forged, mutated, or already-persisted invalid evidence instead of repairing it.