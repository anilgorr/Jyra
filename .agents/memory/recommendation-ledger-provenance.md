---
name: Recommendation ledger provenance
description: Immutable recommendation history must copy exact assessment-time versions and keep feedback append-only.
---

Recommendation history must copy exact assessment-time model, ICP, Business Twin, and Intelligence Pack identifiers from immutable Opportunity inputs. Never infer a historical pack from whichever version is active or latest when the recommendation is read.

**Why:** A later pack activation can otherwise relabel an earlier recommendation, corrupting both explanation provenance and outcome-learning data.

**How to apply:** Persist the exact pack used during Opportunity evaluation, restrict evaluated signals and clusters to that pack, copy the stored identifier into ledger snapshots, and enforce model/ICP/pack/Business Twin lineage in database constraints. Outcomes are append-only events; omitted or skipped actions remain neutral and are not negative feedback.