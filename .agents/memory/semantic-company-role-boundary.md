---
name: Semantic company-role boundary
description: Guardrails for seller-relative LLM company understanding and commercial-role assessment.
---

Semantic company-role inference must fail closed unless the project has authoritative seller/offering context and the candidate has meaningful, identity-safe evidence. Model citations must be actual project- and company-scoped provenance record IDs; generated labels or unsupported URLs are not citations.

**Why:** Commercial role is seller-relative, and plausible prose can otherwise hide missing seller context or evidence leakage across companies and projects.

**How to apply:** Validate seller-context sufficiency before model invocation, restrict model input to candidate-owned company/profile evidence, validate every cited provenance UUID, and cache on seller context, evidence, model, prompt, and normalization versions.