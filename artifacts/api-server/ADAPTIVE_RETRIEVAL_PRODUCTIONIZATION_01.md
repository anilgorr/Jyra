# Adaptive Retrieval Productionization 01

## Decision

**A — ADAPTIVE RETRIEVAL PRODUCTIONIZED AND FROZEN**

Freeze marker: **MVP_RETRIEVAL_V1_FROZEN**

## Implementation

**PASS**

The normal `ResearchQuestion` WEB_SEARCH path now runs one Tavily PRIMARY request, evaluates the existing deterministic retrieval status, and runs at most one Exa FALLBACK request only for:

- `FALLBACK_INSUFFICIENT`
- `FALLBACK_AMBIGUOUS`
- `FALLBACK_PROVIDER_FAILURE`

A sufficient Tavily result executes no Exa request. If both providers fail, the research job remains failed/incomplete and the project-company research state is not marked complete. Provider failure is not converted into negative buyer evidence.

Regular Exa WEB_SEARCH is a separate adapter from Exa COMPANY_DISCOVERY. Exa Agent, Answer, people search, contact search, automatic enrichment, Unipile, and new providers were not added.

## Normal research path

| Requirement | Result |
| --- | --- |
| Tavily primary | PASS |
| Existing sufficiency gate | PASS |
| Exa conditional fallback | PASS |
| Maximum one provider per stage / two total calls | PASS |
| Provider-failure fallback | PASS |
| Dual-failure incomplete semantics | PASS |
| Provider-neutral normalization | PASS |
| Conservative cross-provider deduplication | PASS |
| Multi-provider provenance retained | PASS |
| Publisher/provider separation | PASS |
| Entity and seller rejection | PASS |
| Temporal fields retained | PASS |
| Per-attempt cost and diagnostics | PASS |
| Append-only economics compatibility | PASS |
| Credential redaction | PASS |

Provider-role selection supports explicit configuration and safe defaults for existing catalog records: Tavily is PRIMARY and Exa is FALLBACK. Stage routing is capped before execution so multiple same-role records cannot exceed the logical call limit. Budget reservation uses the exact ranked PRIMARY plus FALLBACK worst case.

Provider usage is buffered until assessment metadata is known, then written once to append-only request-cost records. Each attempt retains provider identity, request ID, query, stage, status, timing, result diagnostics, fallback reason, estimated cost, actual cost when available, and redacted provider metadata.

## Mocked tests

| Test | Result |
| --- | --- |
| A — Tavily sufficient | PASS |
| B — Tavily insufficient | PASS |
| C — Tavily ambiguous | PASS |
| D — Tavily provider failure | PASS |
| E — Both providers fail | PASS |
| F — Duplicate source | PASS |
| G — Wrong entity | PASS |
| H — Seller content | PASS |

Additional routing tests prove:

- production-like provider records without new role fields retain safe primary/fallback defaults;
- two retryable Tavily PRIMARY records still produce only one primary call;
- the staged cost estimate equals the selected primary plus fallback costs;
- nested API keys, authorization values, access tokens, bare token fields, passwords, secrets, and credential fields are redacted before provider-usage persistence.

## Generic development smoke test

The smoke test used only non-benchmark companies and the development database. Existing Cloudflare and GitLab canonical records were intentionally skipped rather than mutated. One isolated OpenInfra Foundation question ran through the normal `executeResearchNow` path.

| Metric | Result |
| --- | --- |
| Questions executed | 1 |
| Tavily calls | 1 |
| Exa calls | 1 |
| Fallback reasons | `FALLBACK_INSUFFICIENT` |
| Provider failures | 0 |
| Accepted evidence | 6 |
| Duplicate evidence URLs | 0 |
| Wrong entity accepted | 0 |
| Seller content accepted | 0 |
| Production operations | 0 |

The smoke run recorded both immutable provider-attempt cost rows, including an estimated total of USD 0.017. Tavily did not report actual cost; Exa reported its actual cost. Temporary development records were removed after the report was generated.

## Verification

- API typecheck: PASS
- API build: PASS
- Research tests: PASS
- Provider-router tests: PASS
- Exa adapter tests: PASS
- Adaptive A–H suite: PASS
- Independent architecture review: PASS
- Static application security scan: 0 findings
- Privacy/dataflow scan: 0 findings
- Dependency audit: 0 critical, 3 high, 1 moderate, 1 low

The dependency findings are workspace dependency advisories and were not introduced or changed in this retrieval-only milestone. Dependency upgrades were not included because they are outside the frozen retrieval scope.

## Scope controls

- Frozen seven-control benchmark reruns: 0
- Ten-control benchmark reruns: 0
- Fifty-company benchmark reruns: 0
- Benchmark-specific runtime constants: 0
- Unipile calls: 0
- Production database operations: 0
- Extraction, identity, ICP, facts, signals, clusters, scoring, WHY, NBA, contacts, outreach, UI, and learning changes: 0

Retrieval is now frozen for the current MVP. It should be changed only if a later end-to-end benchmark demonstrates a concrete retrieval defect.