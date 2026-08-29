---
name: Next Best Action rule provenance
description: How deterministic action recommendations stay configurable, explainable, and consistent across product surfaces.
---

Next Best Action is an advisory read projection, not Opportunity history and not an action executor. Its configurable policy belongs to the immutable Opportunity model version used by the assessment, and every response must identify the NBA policy and model version actually executed.

**Why:** A standalone default label can falsely imply durable configuration, while accepting or labeling invalid legacy policy can make an explanation name rules that did not run. Different surfaces must not independently infer inputs such as confirmed disqualifiers.

**How to apply:** Build every surface from the same persisted assessment/component semantics, validate policy before persistence, deterministically order explanatory inputs, and fall back atomically to both default rules and the default policy label when legacy configuration is invalid.