---
name: Exa company discovery boundary
description: Product boundary for the first Exa-backed COMPANY_DISCOVERY implementation.
---

Use the official `exa-js` Search API with `category: "company"` and `type: "auto"` for COMPANY_DISCOVERY. Do not use people search, Agent, Answer, Contents, or output-schema synthesis for this milestone.

**Why:** Exa is only the candidate-company retrieval provider. Allowing it to synthesize qualification, intent, or opportunity conclusions would bypass JYRA's provenance, evidence, and reasoning controls.

**How to apply:** Preserve absent Exa fields as unknown. Keep canonicalization, entity resolution, ICP qualification, research priority, evidence governance, signals, and opportunity reasoning in JYRA.