# MVP Fix Cycle 02 — Pre-fix autopsy

## Scope and safety

- Frozen positive controls: 10
- Missed events reconstructed: 8
- Successful controls reconstructed: 2
- Incorrect or unresolved canonical identities reconstructed: 4
- New provider calls: **0**
- Development database mutations: **0**
- Production operations: **0**

## Earliest first-broken stage

- QUERY_OR_RESULT_RELEVANCE: 7
- NO_BREAK_DETECTED: 2
- FACT_EXTRACTION: 1

## Failure buckets

- RETRIEVAL: 7
- SUCCESS: 2
- EVIDENCE_PIPELINE: 1

## Timeout impact

- NO_DEMONSTRATED_IMPACT: 8
- CONTROL_INVALIDATED: 1
- PARTIAL_COVERAGE_LOSS: 1

Infoblox remains a detected positive but is not a valid retest control: all four research slots timed out and no questions were persisted. Nubank has partial coverage loss in EXPANSION. These facts are preserved rather than rewritten to fit the event result.

## Event dispositions

- **SolarWinds** — MISSED; QUERY_OR_RESULT_RELEVANCE; RETRIEVAL; timeout NO_DEMONSTRATED_IMPACT.
- **First Horizon** — MISSED; QUERY_OR_RESULT_RELEVANCE; RETRIEVAL; timeout NO_DEMONSTRATED_IMPACT.
- **GitLab** — DETECTED; NO_BREAK_DETECTED; SUCCESS; timeout NO_DEMONSTRATED_IMPACT.
- **Infoblox** — DETECTED; NO_BREAK_DETECTED; SUCCESS; timeout CONTROL_INVALIDATED.
- **Teradata** — MISSED; QUERY_OR_RESULT_RELEVANCE; RETRIEVAL; timeout NO_DEMONSTRATED_IMPACT.
- **Nubank** — MISSED; QUERY_OR_RESULT_RELEVANCE; RETRIEVAL; timeout PARTIAL_COVERAGE_LOSS.
- **Black Duck** — MISSED; FACT_EXTRACTION; EVIDENCE_PIPELINE; timeout NO_DEMONSTRATED_IMPACT.
- **OpenAssets** — MISSED; QUERY_OR_RESULT_RELEVANCE; RETRIEVAL; timeout NO_DEMONSTRATED_IMPACT.
- **Black & McDonald** — MISSED; QUERY_OR_RESULT_RELEVANCE; RETRIEVAL; timeout NO_DEMONSTRATED_IMPACT.
- **RAKBANK** — MISSED; QUERY_OR_RESULT_RELEVANCE; RETRIEVAL; timeout NO_DEMONSTRATED_IMPACT.

## Identity dispositions

- **Digital Maelstrom** — NOT_ADJUDICABLE; earliest break: PROFILE_RESOLUTION.
- **Mandiant (part of Google Cloud)** — INCORRECT_OR_AMBIGUOUS; earliest break: DOMAIN_RESOLUTION.
- **Managed Services - Monitoring 24/7** — INCORRECT_OR_AMBIGUOUS; earliest break: DOMAIN_RESOLUTION.
- **Corsa** — NOT_ADJUDICABLE; earliest break: PROFILE_RESOLUTION.

## Evidentiary limits

Rejected or unpreserved provider results cannot be reconstructed because historical raw provider responses were not stored independently from accepted crawl payloads. Exact historical fact-extractor output and rejection reasons were also not persisted. Those gaps remain UNKNOWN and are not converted into inferred product defects.
