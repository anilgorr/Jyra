---
name: Exa company discovery boundary
description: Product boundary for the first Exa-backed COMPANY_DISCOVERY implementation.
---

Use the official `exa-js` Search API with `category: "company"` and `type: "auto"` for COMPANY_DISCOVERY. Queries should express one focused market angle and omit geography, size, and technology requirements that belong in downstream qualification. Do not use people search, Agent, Answer, Contents, or output-schema synthesis for this milestone.

**Why:** Exa is only the candidate-company retrieval provider. Allowing it to synthesize qualification, intent, or opportunity conclusions would bypass JYRA's provenance, evidence, and reasoning controls. Combining all ICP dimensions at search time can suppress legitimate candidates before JYRA can preserve unknowns and qualify them.

**How to apply:** Preserve absent Exa fields as unknown and expose raw provider rows before normalization for diagnostic runs. Keep canonicalization, entity resolution, ICP qualification, research priority, evidence governance, signals, and opportunity reasoning in JYRA.