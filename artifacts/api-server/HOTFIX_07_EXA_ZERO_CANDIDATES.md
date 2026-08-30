# JYRA Real Data Hotfix 07 — Exa Zero Candidates

## Final result

**PASS**

The controlled development replay used one of the three allowed Exa calls and
returned ten raw company-category results. All ten remained legitimate initial
discovery candidates. No company, research, evidence, contact, or signal rows
were created.

## Root cause

The historical Test 08 did not lose candidates inside JYRA. Its obsolete
connector-backed provider request failed with HTTP 400 before Exa returned any
raw rows:

`provider request → HTTP 400 → zero raw results`

Therefore entity validation, canonicalization, deduplication, and ICP
qualification were never reached. The historical query was also overconstrained
for discovery and has been replaced with focused high-recall query construction.
The current direct `exa-js` adapter works with `category: "company"`,
`type: "auto"`, and a bounded `numResults`.

| Question | Answer |
|---|---|
| Query problem | YES — discovery query included too many downstream criteria |
| Exa problem | NO |
| Entity resolution problem | NO |
| Domain handling problem | YES — fixed before replay; platform URLs are now domainless identities |
| ICP filtering problem | NO |
| Unknown-semantics problem | NO |

## Query diagnostic

| Field | Value |
|---|---|
| Query number | 1 |
| Exact query | `SaaS companies that may be relevant buyers for Managed Soc` |
| Category | `company` |
| Type | `auto` |
| Results requested | 10 |
| Included | Focused industry; offering context |
| Omitted | Geography, employee size, Azure, Microsoft 365, all-industry conjunction |
| Why | Discovery prioritizes recall; JYRA qualifies known attributes downstream |
| HTTP status | 200 |
| Raw result count | 10 |
| Request ID | `hotfix-07:1:b220e720-6d21-4c7a-badf-3aec920febca` |
| Actual cost | $0.007 |
| Latency | 1854 ms |

No general-search comparison was needed because company-category search returned
ten usable rows.

## Raw response

| # | Title | URL | Provider result ID | Snippet |
|---:|---|---|---|---|
| 1 | Digital Maelstrom | https://digitalmaelstrom.net | https://exa.ai/library/organization/fjzrpfm8kmn | Not returned |
| 2 | Truvo Cyber | https://truvocyber.com | https://exa.ai/library/organization/vjby0qxjcbn | Not returned |
| 3 | CyberForge | https://cyberforgeconsulting.com | https://exa.ai/library/organization/39gbqxg8q21 | Not returned |
| 4 | Simple IT Inc | https://simpleitindy.com | https://exa.ai/library/organization/jlp00fkpd1z | Not returned |
| 5 | Jutsu Inc. | https://agentsoc.com | https://exa.ai/library/organization/q0sns1fmj90 | Not returned |
| 6 | CybrX IT | https://cybrxit.com | https://exa.ai/library/organization/jwlxpvb1ymy | Not returned |
| 7 | Cycore | https://cycoresecure.com | https://exa.ai/library/organization/8w35v4vmm05 | Not returned |
| 8 | SecureSky | https://securesky.com | https://exa.ai/library/organization/x2r6b3zs4vr | Not returned |
| 9 | Decrypt Compliance | https://decrypt.cpa | https://exa.ai/library/organization/vrytr4m658c | Not returned |
| 10 | Secov | https://linkedin.com/company/secovhq | https://exa.ai/library/organization/5wbj8vfj2n5 | Not returned |

## Final diagnostic table

All rows came from query 1. `INSUFFICIENT_DATA` is an unknown state, not a
negative qualification.

| Raw company | Exa URL | Entity status | Domain status | Canonicalization status | ICP status | Final candidate | Rejection/drop reason |
|---|---|---|---|---|---|---|---|
| Digital Maelstrom | https://digitalmaelstrom.net | ACCEPTED | HIGH_CONFIDENCE | ACCEPTED_DOMAIN_OPTIONAL | INSUFFICIENT_DATA | YES | None |
| Truvo Cyber | https://truvocyber.com | ACCEPTED | HIGH_CONFIDENCE | ACCEPTED_DOMAIN_OPTIONAL | INSUFFICIENT_DATA | YES | None |
| CyberForge | https://cyberforgeconsulting.com | ACCEPTED | HIGH_CONFIDENCE | ACCEPTED_DOMAIN_OPTIONAL | INSUFFICIENT_DATA | YES | None |
| Simple IT Inc | https://simpleitindy.com | ACCEPTED | HIGH_CONFIDENCE | ACCEPTED_DOMAIN_OPTIONAL | INSUFFICIENT_DATA | YES | None |
| Jutsu Inc. | https://agentsoc.com | ACCEPTED | HIGH_CONFIDENCE | ACCEPTED_DOMAIN_OPTIONAL | INSUFFICIENT_DATA | YES | None |
| CybrX IT | https://cybrxit.com | ACCEPTED | HIGH_CONFIDENCE | ACCEPTED_DOMAIN_OPTIONAL | INSUFFICIENT_DATA | YES | None |
| Cycore | https://cycoresecure.com | ACCEPTED | HIGH_CONFIDENCE | ACCEPTED_DOMAIN_OPTIONAL | INSUFFICIENT_DATA | YES | None |
| SecureSky | https://securesky.com | ACCEPTED | HIGH_CONFIDENCE | ACCEPTED_DOMAIN_OPTIONAL | INSUFFICIENT_DATA | YES | None |
| Decrypt Compliance | https://decrypt.cpa | ACCEPTED | HIGH_CONFIDENCE | ACCEPTED_DOMAIN_OPTIONAL | INSUFFICIENT_DATA | YES | None |
| Secov | https://linkedin.com/company/secovhq | ACCEPTED | NEEDS_RESOLUTION | ACCEPTED_DOMAIN_OPTIONAL | INSUFFICIENT_DATA | YES | None |

## Required counts

| Count | Result |
|---|---:|
| Discovery queries | 1 |
| Exa company-category calls | 1 |
| Raw company-category results | 10 |
| General-search comparison calls | 0 |
| General-search raw results | 0 |
| Entity rejections | 0 |
| Ambiguous entities | 0 |
| Domain-related drops | 0 |
| Canonicalization drops | 0 |
| Duplicates | 0 |
| ICP-related rejections | 0 |
| Unknown-data rejections | 0 |
| Final candidates | 10 |

## Safety verification

| Surface | Delta |
|---|---:|
| Project companies | 0 |
| Research jobs | 0 |
| Evidence rows | 0 |
| Contact-enrichment attempts | 0 |
| Signals | 0 |
| Tavily calls | 0 |
| Apify calls | 0 |
| Production operations | 0 |

The machine-readable sanitized raw-result projection and stage trace are preserved in
`HOTFIX_07_EXA_ZERO_CANDIDATES.json`.