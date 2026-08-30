# JYRA Hotfix 08 — Exa Same-Path Proof

## Final status

**PASS**

The health diagnostic and Find My Market use the same provider registration,
`COMPANY_DISCOVERY` capability, `ProviderRouter`, Exa adapter, server-side
credential, development environment, and Exa request builder.

## Execution paths

| Layer | Health proof | Find My Market | Same |
|---|---|---|---|
| Entrypoint | `scripts/run-hotfix-08-entry.ts` | `POST /projects/:projectId/discovery` in `routes/discovery.ts` | Expected to differ |
| Router function | `ProviderRouter.discoverCompanies` | `ProviderRouter.discoverCompanies` | YES |
| Adapter | `createExaCompanyDiscoveryAdapter.execute` | `createExaCompanyDiscoveryAdapter.execute` | YES |
| SDK call | `exa.search(query, { type: "auto", numResults, category: "company" })` | Same | YES |
| Provider registration | Development Exa provider | Development Exa provider | YES |
| Capability | `COMPANY_DISCOVERY` | `COMPANY_DISCOVERY` | YES |
| Credentials | Server-side `EXA_API_KEY` | Server-side `EXA_API_KEY` | YES |
| Environment | Development | Development | YES |
| Request builder | Exa adapter | Exa adapter | YES |

**Difference found:** The previous health report did not expose the adapter's
raw-result projection. It was not using a different provider implementation.

**Root cause:** No current execution-path divergence exists. Historical Test 08
used the obsolete connector path, which failed before returning raw results.
Hotfix 07 was intentionally a non-persistent diagnostic projection. The current
direct `exa-js` router path returns candidates, and the actual Find My Market
service can persist and return them.

## Sanitized request comparison

| Parameter | Known-working query | GTM-Q1 query |
|---|---|---|
| Query | `SaaS company cloud infrastructure` | `SaaS companies that may be relevant buyers for Managed Soc` |
| Category | `company` | `company` |
| Type | `auto` | `auto` |
| `numResults` | 3 | 10 |
| Contents | Omitted | Omitted |
| `includeDomains` | Omitted | Omitted |
| `excludeDomains` | Omitted | Omitted |
| Date filters | Omitted | Omitted |
| Other filters | None | None |

No API key or credential value was read, printed, or persisted.

## Known-working query raw output

API success: **YES**  
Provider: Exa through `ProviderRouter.discoverCompanies`  
Raw results: **3**  
Normalized results: **3**  
Request ID: `hotfix-08:1:b220e720-6d21-4c7a-badf-3aec920febca`  
Actual cost: **$0.007**  
Latency: **1368 ms**

| # | Result ID | Title | Raw URL | Description |
|---:|---|---|---|---|
| 1 | https://exa.ai/library/organization/wmgnn2yrk5j | Nubosas | https://nubosas.com | Not returned |
| 2 | https://exa.ai/library/organization/3r1h9bzfzlt | InfraVault | https://linkedin.com/company/infravault | Not returned |
| 3 | https://exa.ai/library/organization/9rxnfkjgypd | Em Tech | https://linkedin.com/company/ems-tech | Not returned |

## Known-working normalization

| Raw title | Raw URL | Normalized company | Normalized source URL | Canonical domain | LinkedIn URL | Status |
|---|---|---|---|---|---|---|
| Nubosas | https://nubosas.com | Nubosas | https://nubosas.com | nubosas.com | — | SURVIVED |
| InfraVault | https://linkedin.com/company/infravault | InfraVault | https://linkedin.com/company/infravault | UNKNOWN | https://linkedin.com/company/infravault | SURVIVED |
| Em Tech | https://linkedin.com/company/ems-tech | Em Tech | https://linkedin.com/company/ems-tech | UNKNOWN | https://linkedin.com/company/ems-tech | SURVIVED |

## Known-working stage counters

| Stage | Count |
|---|---:|
| 01 Provider raw results | 3 |
| 02 Normalized results | 3 |
| 03 Entity-valid candidates | 3 |
| 04 Canonicalization survivors | 3 |
| 05 Dedupe survivors | 3 |
| 06 ICP qualification survivors | 3 |
| 07 Persistable candidates | 3 |
| 08 Final Find My Market results | 3 |

No candidate dropped. InfraVault and Em Tech retained company identity using
their names, Exa result IDs, source URLs, and LinkedIn URLs while their
canonical domains remained unknown.

## GTM-Q1 query result

The second real routed request returned **10 raw results** and **10 normalized
results**. All 10 were entity-valid, canonicalization-safe, unique in the
response, retained through unknown-aware ICP qualification, and persistable.

The captured response was then replayed through
`discoverCompaniesForProject` without another provider call:

- Final service/API candidates: **10**
- Canonical companies created: **10**
- Project-company links created: **10**
- Possible matches: **0**
- Rejections: **0**
- Database error: **NO**
- Additional Exa calls during persistence replay: **0**

## Required candidate table

| Company | Raw Exa URL | Canonical domain | Entity status | ICP status | Final status |
|---|---|---|---|---|---|
| Digital Maelstrom | https://digitalmaelstrom.net | digitalmaelstrom.net | VALID | INSUFFICIENT_DATA | LINKED |
| Truvo Cyber | https://truvocyber.com | truvocyber.com | VALID | INSUFFICIENT_DATA | LINKED |
| CyberForge | https://cyberforgeconsulting.com | cyberforgeconsulting.com | VALID | INSUFFICIENT_DATA | LINKED |
| Simple IT Inc | https://simpleitindy.com | simpleitindy.com | VALID | INSUFFICIENT_DATA | LINKED |
| Jutsu Inc. | https://agentsoc.com | agentsoc.com | VALID | INSUFFICIENT_DATA | LINKED |
| CybrX IT | https://cybrxit.com | cybrxit.com | VALID | INSUFFICIENT_DATA | LINKED |
| Cycore | https://cycoresecure.com | cycoresecure.com | VALID | INSUFFICIENT_DATA | LINKED |
| SecureSky | https://securesky.com | securesky.com | VALID | INSUFFICIENT_DATA | LINKED |
| Decrypt Compliance | https://decrypt.cpa | decrypt.cpa | VALID | INSUFFICIENT_DATA | LINKED |
| Secov | https://linkedin.com/company/secovhq | UNKNOWN | VALID | INSUFFICIENT_DATA | LINKED |

Secov survived with `canonical_domain = UNKNOWN`; its LinkedIn URL remains a
profile/source URL rather than becoming `linkedin.com`.

## Required final report

| Field | Result |
|---|---|
| Health test and Find My Market same path | YES |
| Provider Router selected | Exa |
| Known query raw results | 3 |
| Known query normalized results | 3 |
| Entity valid | 3 |
| Canonicalization survivors | 3 |
| Dedupe survivors | 3 |
| ICP survivors | 3 |
| Persistable | 3 |
| Final known-query projected results | 3 |
| ICP raw results | 10 |
| ICP final service/API candidates | 10 |
| Drop point | NONE |
| Drop reason | NONE |
| Database error | NO |

## Safety

| Operation | Count |
|---|---:|
| Real Exa calls | 2 |
| Tavily calls | 0 |
| Apify calls | 0 |
| Contact enrichment | 0 |
| Signals created | 0 |
| Production operations | 0 |

The full sanitized projections, normalized candidates, stage traces, and
persistence result are in `HOTFIX_08_EXA_SAME_PATH.json`.