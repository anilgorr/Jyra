---
name: Live semantic contract validation
description: Why strict structured semantic outputs need representative live contract probes before costly evaluation runs.
---

Strict semantic response schemas must be exercised against representative live model output before starting paid cohort research. Deterministic fixtures can prove validator behavior while missing systematic omissions such as required evidence bindings or bounded rationale fields.

**Why:** A frozen evidence-first regression completed its research budget but accepted no assessments because every live semantic response omitted required provenance bindings; several responses also exceeded a length bound. The architecture and validator behaved as designed, but the model-adapter contract had not been proven end to end.

**How to apply:** Before freezing or running a paid cohort, run generic live contract probes that require every role, WHO, and criterion decision to carry value-compatible claim bindings. Fail before research fan-out if the configured model, prompt, parser, and schema cannot round-trip that contract. Any deterministic repair may only derive bindings from claims the response already cited; it must never fabricate provenance.