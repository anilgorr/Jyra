# Retrieval Bake-off 01

## Decision

**A — QUERY CONSTRUCTION IS PRIMARY BOTTLENECK** — Generic query variants improved coverage over the current Tavily query behavior.

This is an isolated, development-only retrieval experiment. It did not write research, evidence, fact, signal, company, contact, or provider-usage records, and it did not alter provider routing.

## Frozen scope and blindness

- Controls tested: **7**, selected only from MVP_FIX_CYCLE_02_AUTOPSY.json rows whose first broken stage was QUERY_OR_RESULT_RELEVANCE.
- Excluded: the Black Duck extraction failure, two successful controls, additional companies, the normal 10-control benchmark, and the 50-company benchmark.
- Queries use company identity, canonical domain, and generic research-area language only.
- Reference event, person, source URL, date, and event-specific technology tokens were checked out of every improved query.
- Provider payloads are preserved separately from normalized and adjudicated projections.

## Provider health

| Provider | Status | Results | Latency (ms) | Error |
|---|---|---:|---:|---|
| tavily | AVAILABLE | 10 | 8223 | — |
| exa | AVAILABLE | 10 | 2288 | — |

## Arm comparison

| Arm | Events found | Recall | Tier 1 controls | Tier 1+2 controls | Tier 3 results | Tier 4 results | Wrong entity | Irrelevant | Avg useful rank | Calls | Avg latency ms | Estimated cost | Actual cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CURRENT_TAVILY | 5/7 | 0.714 | 3 | 5 | 10 | 0 | 10 | 0 | 1.60 | 7 | 3841.3 | $0.0700 | UNKNOWN (0/7 reported) |
| IMPROVED_TAVILY | 7/7 | 1.000 | 6 | 7 | 22 | 1 | 6 | 2 | 1.14 | 14 | 4786.6 | $0.1400 | UNKNOWN (0/14 reported) |
| IMPROVED_EXA | 7/7 | 1.000 | 6 | 7 | 46 | 0 | 0 | 0 | 1.00 | 14 | 1995.9 | $0.0980 | $0.0980 |

Tier coverage counts frozen controls with at least one event-bearing result at that authority level. Useful-result rank is averaged over exact and same-event alternate-source results. Temporal quality is measured only on event-bearing results.

## Temporal quality of event-bearing results

| Arm | Current | Recent | Stale | Unknown date |
|---|---:|---:|---:|---:|
| CURRENT_TAVILY | 0 | 0 | 0 | 18 |
| IMPROVED_TAVILY | 0 | 0 | 0 | 44 |
| IMPROVED_EXA | 31 | 30 | 3 | 10 |

## Complementarity

- Union across all arms: **7/7** controls.
- Found by both improved arms: **7**.
- Improved Exa-only controls: **0**.
- Improved Tavily-only controls: **0**.
- Found by neither improved arm: **0**.

## Query improvement

- Current Tavily recall: **0.714**
- Improved Tavily recall: **1.000**
- Recall delta: **+0.286**
- Additional calls: **7**
- Additional estimated cost: **$0.0700**
- Additional actual cost: **UNKNOWN (Tavily did not report actual request costs)**
- Classification: **MAJOR_QUERY_PROBLEM**
- Gained controls: **Black & McDonald, RAKBANK**
- Regressed controls: **None**

## Cost per event-bearing control

| Arm | Estimated | Actual |
|---|---:|---:|
| CURRENT_TAVILY | $0.0140 | UNKNOWN |
| IMPROVED_TAVILY | $0.0200 | UNKNOWN |
| IMPROVED_EXA | $0.0140 | $0.0140 |

## Per-control comparison

T/S/P indicates whether the title, provider snippet/highlight, or retrieved page text demonstrated the event. Reference event fields are evaluation-only and were excluded from all query construction.

| Company | Evaluation-only reference event | Current Tavily | Improved Tavily | Improved Exa | Query delta | Winner | LinkedIn opportunity |
|---|---|---|---|---|---|---|---|
| SolarWinds | SolarWinds appointed Justin Henkel as Chief Information Security Officer. | Queries: "SolarWinds" solarwinds.com public evidence of security leadership changes (security, ciso); calls 1; results 10; event YES EXACT_EVENT #9; TIER_1_DIRECT; T/S/P/URL; https://www.solarwinds.com/company/newsroom/press-releases/solarwinds-appoints-justin-henkel-as-chief-information-security-officer; published UNKNOWN; event date 2026-06-17 (explicit); retrieved 2026-08-31T15:48:27.675Z; UNKNOWN_DATE; 3784ms; est $0.010; actual UNKNOWN (0/1) | Queries: "SolarWinds" solarwinds.com security leadership appointment public announcement || "SolarWinds" solarwinds.com CISO security executive news; calls 2; results 20; event YES EXACT_EVENT #1; TIER_1_DIRECT; T/S/P/URL; https://www.solarwinds.com/company/newsroom/press-releases/solarwinds-appoints-justin-henkel-as-chief-information-security-officer; published UNKNOWN; event date 2026-06-17 (explicit); retrieved 2026-08-31T15:48:31.461Z; UNKNOWN_DATE; 8188ms; est $0.020; actual UNKNOWN (0/2) | Queries: "SolarWinds" solarwinds.com security leadership appointment public announcement || "SolarWinds" solarwinds.com CISO security executive news; calls 2; results 20; event YES EXACT_EVENT #1; TIER_1_DIRECT; T/S/P/URL; https://www.solarwinds.com/company/newsroom/press-releases/solarwinds-appoints-justin-henkel-as-chief-information-security-officer; published 2026-06-17T00:00:00.000Z; event date 2026-06-17 (explicit); retrieved 2026-08-31T15:48:41.493Z; CURRENT; 4268ms; est $0.014; actual $0.014 | NO_CHANGE_FOUND | TIE | YES: LINKEDIN_PERSON_PROFILE, LINKEDIN_POST |
| First Horizon | First Horizon appointed Leilani Farol as Chief Information Security Officer. | Queries: "First Horizon National Corp" fhnc.com public evidence of security leadership changes (security, ciso); calls 1; results 10; event YES SAME_EVENT_ALTERNATE_SOURCE #4; TIER_2_HIGH_AUTHORITY; S/P; https://www.prnewswire.com/news-releases/first-horizon-appoints-leilani-farol-as-chief-information-security-officer-302685334.html; published UNKNOWN; event date 2026-02-11 (explicit); retrieved 2026-08-31T15:48:43.922Z; UNKNOWN_DATE; 5092ms; est $0.010; actual UNKNOWN (0/1) | Queries: "First Horizon" fhnc.com security leadership appointment public announcement || "First Horizon" fhnc.com CISO security executive news; calls 2; results 20; event YES SAME_EVENT_ALTERNATE_SOURCE #2; TIER_2_HIGH_AUTHORITY; S/P; https://www.prnewswire.com/news-releases/first-horizon-appoints-leilani-farol-as-chief-information-security-officer-302685334.html; published UNKNOWN; event date 2026-02-11 (explicit); retrieved 2026-08-31T15:48:49.017Z; UNKNOWN_DATE; 6201ms; est $0.020; actual UNKNOWN (0/2) | Queries: "First Horizon" fhnc.com security leadership appointment public announcement || "First Horizon" fhnc.com CISO security executive news; calls 2; results 20; event YES EXACT_EVENT #1; TIER_1_DIRECT; T/S/P/URL; https://ir.firsthorizon.com/press-releases/press-release-details/2026/First-Horizon-Appoints-Leilani-Farol-as-Chief-Information-Security-Officer/default.aspx; published 2026-02-11T00:00:00.000Z; event date 2026-02-11 (explicit); retrieved 2026-08-31T15:48:57.307Z; RECENT; 4448ms; est $0.014; actual $0.014 | NO_CHANGE_FOUND | EXA | YES: LINKEDIN_POST, LINKEDIN_PERSON_PROFILE |
| Teradata | Teradata appointed Ken Ricketts as Chief Information Security Officer. | Queries: "Teradata" teradata.com public evidence of security leadership changes (security, ciso); calls 1; results 10; event YES EXACT_EVENT #4; TIER_1_DIRECT; T/S/P/URL; https://www.teradata.com/press-releases/2026/teradata-appoints-ken-ricketts-as-ciso; published UNKNOWN; event date 2026-01-21 (explicit); retrieved 2026-08-31T15:48:59.673Z; UNKNOWN_DATE; 3066ms; est $0.010; actual UNKNOWN (0/1) | Queries: "Teradata" teradata.com security leadership appointment public announcement || "Teradata" teradata.com CISO security executive news; calls 2; results 20; event YES EXACT_EVENT #2; TIER_1_DIRECT; T/S/P/URL; https://www.teradata.com/press-releases/2026/teradata-appoints-ken-ricketts-as-ciso; published UNKNOWN; event date 2026-01-21 (explicit); retrieved 2026-08-31T15:49:02.740Z; UNKNOWN_DATE; 6085ms; est $0.020; actual UNKNOWN (0/2) | Queries: "Teradata" teradata.com security leadership appointment public announcement || "Teradata" teradata.com CISO security executive news; calls 2; results 20; event YES EXACT_EVENT #1; TIER_1_DIRECT; T/S/P/URL; https://www.teradata.com/press-releases/2026/teradata-appoints-ken-ricketts-as-ciso; published 2026-01-21T00:00:00.000Z; event date 2026-01-21 (explicit); retrieved 2026-08-31T15:49:10.926Z; RECENT; 3657ms; est $0.014; actual $0.014 | NO_CHANGE_FOUND | EXA | YES: LINKEDIN_POST, LINKEDIN_PERSON_PROFILE |
| Nubank | Nubank appointed John Walton as Chief Information Security Officer. | Queries: "Nubank" nubank.com.br public evidence of security leadership changes (security, ciso); calls 1; results 10; event YES EXACT_EVENT #4; TIER_1_DIRECT; T/S/P/URL; https://international.nubank.com.br/company/nubank-appoints-john-walton-as-chief-information-security-officer; published UNKNOWN; event date 2026-06-08 (explicit); retrieved 2026-08-31T15:49:12.484Z; UNKNOWN_DATE; 2719ms; est $0.010; actual UNKNOWN (0/1) | Queries: "Nubank" nubank.com.br security leadership appointment public announcement || "Nubank" nubank.com.br CISO security executive news; calls 2; results 20; event YES EXACT_EVENT #1; TIER_1_DIRECT; T/S/P/URL; https://international.nubank.com.br/company/nubank-appoints-john-walton-as-chief-information-security-officer; published UNKNOWN; event date 2026-06-08 (explicit); retrieved 2026-08-31T15:49:22.161Z; UNKNOWN_DATE; 16276ms; est $0.020; actual UNKNOWN (0/2) | Queries: "Nubank" nubank.com.br security leadership appointment public announcement || "Nubank" nubank.com.br CISO security executive news; calls 2; results 20; event YES EXACT_EVENT #1; TIER_1_DIRECT; T/S/P/URL; https://international.nubank.com.br/company/nubank-appoints-john-walton-as-chief-information-security-officer/; published 2026-06-08T00:00:00.000Z; event date 2026-06-08 (explicit); retrieved 2026-08-31T15:49:34.082Z; CURRENT; 4180ms; est $0.014; actual $0.014 | NO_CHANGE_FOUND | TIE | YES: LINKEDIN_POST, LINKEDIN_PERSON_PROFILE |
| OpenAssets | OpenAssets achieved SOC 2 Type 2 compliance and renewed ISO 27001 certification. | Queries: "OpenAssets" openassets.to public evidence of funding, expansion, security, or compliance initiatives; calls 1; results 10; event YES EXACT_EVENT #8; TIER_2_HIGH_AUTHORITY; T/S/P/URL; https://www.prnewswire.com/news-releases/openassets-achieves-soc-2-type-2-compliance-and-renews-iso-27001-certification-302840457.html; published UNKNOWN; event date 2026-08-03 (explicit); retrieved 2026-08-31T15:49:35.665Z; UNKNOWN_DATE; 3534ms; est $0.010; actual UNKNOWN (0/1) | Queries: "OpenAssets" openassets.to security compliance certification public announcement || "OpenAssets" openassets.to cybersecurity assurance compliance news; calls 2; results 20; event YES EXACT_EVENT #2; TIER_2_HIGH_AUTHORITY; T/S/P/URL; https://www.prnewswire.com/news-releases/openassets-achieves-soc-2-type-2-compliance-and-renews-iso-27001-certification-302840457.html; published UNKNOWN; event date 2026-08-03 (explicit); retrieved 2026-08-31T15:49:39.201Z; UNKNOWN_DATE; 8334ms; est $0.020; actual UNKNOWN (0/2) | Queries: "OpenAssets" openassets.to security compliance certification public announcement || "OpenAssets" openassets.to cybersecurity assurance compliance news; calls 2; results 20; event YES EXACT_EVENT #1; TIER_2_HIGH_AUTHORITY; T/S/P/URL; https://www.prnewswire.com/news-releases/openassets-achieves-soc-2-type-2-compliance-and-renews-iso-27001-certification-302840457.html; published 2026-08-03T00:00:00.000Z; event date 2026-08-03 (explicit); retrieved 2026-08-31T15:49:49.678Z; CURRENT; 4443ms; est $0.014; actual $0.014 | NO_CHANGE_FOUND | EXA | YES: LINKEDIN_POST |
| Black & McDonald | Black & McDonald achieved ISO 27001 certification and completed a SOC 2 Type II examination. | Queries: "Black & McDonald Limited" blackandmcdonald.com public evidence of funding, expansion, security, or compliance initiatives; calls 1; results 10; event NO; 4138ms; est $0.010; actual UNKNOWN (0/1) | Queries: "Black & McDonald" blackandmcdonald.com security compliance certification public announcement || "Black & McDonald" blackandmcdonald.com cybersecurity assurance compliance news; calls 2; results 20; event YES SAME_EVENT_ALTERNATE_SOURCE #1; TIER_1_DIRECT; T/S/P; https://blackandmcdonald.com/us/news/bm-achieves-iso-27001-certification-and-completes-soc-2-type-ii-examination; published UNKNOWN; event date 2026-05-08 (explicit); retrieved 2026-08-31T15:49:56.122Z; UNKNOWN_DATE; 10764ms; est $0.020; actual UNKNOWN (0/2) | Queries: "Black & McDonald" blackandmcdonald.com security compliance certification public announcement || "Black & McDonald" blackandmcdonald.com cybersecurity assurance compliance news; calls 2; results 20; event YES EXACT_EVENT #1; TIER_1_DIRECT; T/S/P/URL; https://blackandmcdonald.com/news/bm-achieves-iso-27001-certification-and-completes-soc-2-type-ii-examination/; published 2026-05-08T00:00:00.000Z; event date 2026-05-08 (explicit); retrieved 2026-08-31T15:50:08.739Z; RECENT; 3486ms; est $0.014; actual $0.014 | GAIN | EXA | YES: LINKEDIN_COMPANY_PROFILE, LINKEDIN_POST |
| RAKBANK | RAKBANK replaced ArcSight with Securonix for security operations. | Queries: "RAKBANK" rakbank.ae public evidence of security stack, SOC, SIEM, EDR, or IAM changes (security, siem, endpoint, iam); calls 1; results 10; event NO; 4556ms; est $0.010; actual UNKNOWN (0/1) | Queries: "RAKBANK" rakbank.ae security operations technology change public announcement || "RAKBANK" rakbank.ae cybersecurity infrastructure platform change news; calls 2; results 20; event YES EXACT_EVENT #2; TIER_1_DIRECT; T/S/P/URL; https://www.securonix.com/resources/rakbank-replaces-arcsight-with-securonix-accelerates-threat-detection-and-data-retrieval-with-snowflake-integration; published UNKNOWN; event date UNKNOWN (not explicit); retrieved 2026-08-31T15:50:19.787Z; UNKNOWN_DATE; 11165ms; est $0.020; actual UNKNOWN (0/2) | Queries: "RAKBANK" rakbank.ae security operations technology change public announcement || "RAKBANK" rakbank.ae cybersecurity infrastructure platform change news; calls 2; results 20; event YES EXACT_EVENT #1; TIER_1_DIRECT; T/S/P/URL; https://www.securonix.com/resources/rakbank-replaces-arcsight-with-securonix-accelerates-threat-detection-and-data-retrieval-with-snowflake-integration/; published 2025-05-08T00:00:00.000Z; event date UNKNOWN (not explicit); retrieved 2026-08-31T15:50:27.756Z; STALE; 3461ms; est $0.014; actual $0.014 | GAIN | EXA | YES: LINKEDIN_POST, LINKEDIN_PERSON_PROFILE |

## Category analysis

| Category | Controls | Current Tavily | Improved Tavily | Improved Exa |
|---|---:|---:|---:|---:|
| SECURITY_LEADERSHIP | 4 | 4 (1.000) | 4 (1.000) | 4 (1.000) |
| FUNDED_RISK_PROGRAM | 2 | 1 (0.500) | 2 (1.000) | 2 (1.000) |
| SECURITY_STACK_CHANGE | 1 | 0 (0.000) | 1 (1.000) | 1 (1.000) |

## LinkedIn opportunity

- YES / NO / UNKNOWN controls: **7 / 0 / 0**
- This bake-off records opportunity only; it does not call Unipile or change LinkedIn architecture.

| Company | Classification | Observable LinkedIn source types | Supporting retrieved rows |
|---|---|---|---:|
| SolarWinds | YES | LINKEDIN_PERSON_PROFILE, LINKEDIN_POST | 4 |
| First Horizon | YES | LINKEDIN_POST, LINKEDIN_PERSON_PROFILE | 5 |
| Teradata | YES | LINKEDIN_POST, LINKEDIN_PERSON_PROFILE | 8 |
| Nubank | YES | LINKEDIN_POST, LINKEDIN_PERSON_PROFILE | 6 |
| OpenAssets | YES | LINKEDIN_POST | 10 |
| Black & McDonald | YES | LINKEDIN_COMPANY_PROFILE, LINKEDIN_POST | 5 |
| RAKBANK | YES | LINKEDIN_POST, LINKEDIN_PERSON_PROFILE | 4 |

## Required summary

- Controls: **7**
- Tavily current: **5/7**, recall **0.714**
- Tavily improved: **7/7**, recall **1.000**
- Exa improved: **7/7**, recall **1.000**
- Found by both / only Tavily / only Exa / neither: **7 / 0 / 0 / 0**
- Tier 1+2 source coverage — current / improved Tavily / Exa: **5/7 / 7/7 / 7/7**
- Wrong entity results — current / improved Tavily / Exa: **10 / 6 / 0**
- Estimated cost — current / improved Tavily / Exa: **$0.0700 / $0.1400 / $0.0980**

## Adjudication labels

{
  "EXACT_EVENT": 25,
  "SAME_EVENT_ALTERNATE_SOURCE": 111,
  "RELATED_EVENT": 61,
  "GENERIC_COMPANY_CONTENT": 135,
  "WRONG_ENTITY": 16,
  "IRRELEVANT": 2
}

## Required artifacts

1. RETRIEVAL_BAKEOFF_01.md — this human-readable report.
2. RETRIEVAL_BAKEOFF_01.json — aggregate metrics, per-control comparison, economics, complementarity, and one decision.
3. RETRIEVAL_BAKEOFF_01_RESULTS.json — result-level labels, authority tiers, temporal quality, match surfaces, and LinkedIn source evidence.
4. RETRIEVAL_BAKEOFF_01_RAW_INDEX.json — sanitized raw request/response metadata and provider result payloads.
5. RETRIEVAL_BAKEOFF_01_QUERY_COMPARISON.json — frozen population, blinded queries, and query-arm definitions.
