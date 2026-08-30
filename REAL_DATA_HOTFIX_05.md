# JYRA Real Data Hotfix 05 — Tavily Evidence Quality

**Scope:** Existing development-only Tavily payloads for 7C Studio (`7cstudio.com`)  
**Reprocessed:** 2026-08-30 07:48 UTC  
**New searches:** 0  
**Production data touched:** No

## Result

PASS. Ten stored Tavily payloads received persisted entity, source-quality, acceptance, and duplicate decisions. Four canonical items remain eligible for facts and signals. Immutable crawl payloads and provider provenance were preserved.

| Source | Classification | Entity decision | Confidence | Accepted | Duplicate | Reason |
|---|---|---:|---:|---:|---:|---|
| `crunchbase.com/organization/7c-studio` | Business database | Confirmed | 95 | Yes | No | Names 7C Studio and references `7cstudio.com`. |
| `discover.7cstudio.com` | Official website | Confirmed | 100 | Yes | No | Canonical-domain subdomain. |
| `in.linkedin.com/company/7evenc` | Social company profile | Confirmed | 95 | Yes | No | Names 7C Studio, links `7cstudio.com`, and matches the Bengaluru company profile. |
| `7cstudio.com` | Official website | Confirmed | 100 | Yes | No | Canonical company domain. |
| `tn.linkedin.com/company/7evenc` | Social company profile | Confirmed | 95 | No | Yes | Regional rendering duplicates the canonical LinkedIn payload. |
| `facebook.com/Studio7C` | Social company profile | Wrong entity | 0 | No | No | San Francisco storytelling agency. |
| second `discover.7cstudio.com` capture | Official website | Confirmed | 100 | No | Yes | Duplicate canonical URL capture. |
| `inc42.com/company/7c-studio/latest` | News | Ambiguous | 40 | No | No | Name-only result without canonical-domain corroboration. |
| `instagram.com/7c_studio_photography` | Social company profile | Wrong entity | 0 | No | No | Photography studio with no canonical-company link. |
| `goodfirms.co/company/7c-studio` | Business database | Ambiguous | 40 | No | No | Name-only result without canonical-domain corroboration. |

## Counts

- Confirmed entity: 6
- Probable entity: 0
- Ambiguous entity: 2
- Wrong entity: 2
- Duplicate stored results: 2
- Canonical accepted evidence items: 4
- Signal-eligible evidence items: 4
- Company facts before/after: 2 / 2
- Signals before/after: 0 / 0
- Existing signals/clusters revoked: 0 / 0

## Controls added

- Entity attribution occurs before Tavily evidence preservation or fact extraction.
- Source classification is independent from entity confidence and legacy evidence confidence.
- Canonical identity removes protocol, `www`, fragments, campaign parameters, and regional LinkedIn-host differences while preserving meaningful paths.
- Reviewed rejected or duplicate records cannot be selected for fact extraction.
- Existing signals and clusters backed by newly rejected evidence are retired to a zero-strength stale state.
- Evidence UI displays source classification, entity decision, entity confidence, reliability, acceptance, and reasons.
- Raw crawl payloads remain immutable; review decisions are stored separately.