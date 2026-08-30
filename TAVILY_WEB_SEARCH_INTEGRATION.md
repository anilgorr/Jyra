# JYRA — Tavily WEB_SEARCH Integration

## Required report

- **TAVILY INTEGRATION:** PASS
- **PROVIDER:** Tavily
- **CAPABILITY:** `WEB_SEARCH`
- **CREDENTIAL STATUS:** AVAILABLE
- **HEALTH:** HEALTHY
- **ROUTER SELECTION:** PASS
- **TEST COMPANY:** 7C Studio
- **DOMAIN:** `7cstudio.com`
- **PROJECT:** GTM-Q1
- **OFFERING:** Managed SOC
- **ACTIVE SIGNAL PACK:** `managed-soc` v1.0
- **QUERIES PLANNED:** 4
- **QUERIES ACTUALLY EXECUTED:** 3 company-search calls during implementation and hardening
- **TOTAL API CALLS:** 4, including one non-evidence health check
- **TOTAL COMPANY RESULTS RETURNED:** 30
- **RESULTS ATTRIBUTED TO CORRECT COMPANY:** 4 unique retained sources
- **AMBIGUOUS/WRONG-ENTITY RESULT INSTANCES REJECTED:** 24 across the initial call and two validation calls
- **DUPLICATES SKIPPED/CLEANED:** 2 duplicate records identified; no duplicate evidence remains
- **NEW RAW EVIDENCE CREATED:** 4
- **CREDITS USED:** Not returned by Tavily
- **ACTUAL COST:** Not available from Tavily response
- **ESTIMATED COST RECORDED:** $0.04 across the health check and three company calls
- **ANY FACTS AUTO-APPROVED:** NO
- **ANY SIGNALS CREATED DIRECTLY FROM SEARCH:** NO
- **PROVENANCE:** PASS
- **PRODUCTION TOUCHED:** NO
- **FINAL STATUS:** PASS

## Architecture

```text
Research Planner
  → Provider Router
  → generic WEB_SEARCH adapter
  → Tavily
  → normalized public source results
  → entity attribution and deduplication
  → RAW evidence
```

Apify remains registered for `WEBSITE_CRAWL`. Tavily is not called from company-specific research logic and is selected dynamically from the provider registry for `WEB_SEARCH`.

## Provider implementation

The Tavily adapter supports:

- query
- result limit
- basic or advanced search depth
- included domains
- excluded domains
- topic
- time range
- start date
- end date
- optional raw content

Normalized results preserve:

- title
- source URL
- source domain
- snippet/content
- raw content when returned
- published date when returned
- provider relevance score when returned
- query
- retrieval timestamp
- provider response metadata

Downstream research code does not depend on Tavily-specific field names.

## Credential safety

`TAVILY_API_KEY` is read server-side from Replit Secrets.

The key is not stored in:

- provider configuration
- database usage records
- company evidence
- logs
- API responses
- frontend code
- provider diagnostics

Missing credentials return `CREDENTIALS_MISSING`. Authentication, rate limiting, timeout, malformed response, provider unavailability, and zero-result outcomes are represented independently from company or opportunity state.

## Health check

A minimal real search was sent through the generic Provider Router.

- Response: success
- Results: 1
- Schema recognized: yes
- Company evidence created: no
- Usage record created: yes

Provider Diagnostics now reports Tavily as `HEALTHY`.

## Planner output

The provider-neutral planner derived four bounded research questions from the active signal definitions:

1. Security leadership changes
2. Security and cybersecurity hiring
3. Funding, expansion, security, or compliance initiatives
4. Security stack, SOC, SIEM, EDR, or IAM changes

The generated query text includes the company name and canonical domain. Query keywords remain research instructions only and never become facts or signals.

## Controlled execution

The implementation required three company-search calls:

1. Initial external-evidence test.
2. Strict entity-attribution validation.
3. Fresh-source and content-deduplication validation.

This remained below the four-search boundary. No other company was searched.

The final validation call returned:

- Results returned: 10
- Existing attributable source treated as duplicate: 1
- Ambiguous results rejected: 9
- New RAW evidence: 0
- Fact proposals: 0

The call completed successfully after the governed refresh path was updated to reuse the existing research-question record.

## Retained RAW evidence

| Source URL | Source domain | Attribution basis |
|---|---|---|
| `https://7cstudio.com` | `7cstudio.com` | Canonical company domain |
| `https://discover.7cstudio.com` | `discover.7cstudio.com` | Canonical-domain subdomain |
| `https://crunchbase.com/organization/7c-studio` | `crunchbase.com` | Exact company name and explicit `7cstudio.com` corroboration |
| `https://in.linkedin.com/company/7evenc` | `in.linkedin.com` | Exact company name and explicit `7cstudio.com` website corroboration |

Each retained evidence record has:

- company ID
- source URL
- source domain
- provider ID
- observation timestamp
- immutable raw-content reference
- normalized content hash
- evidence-quality scores
- `RAW` status

## Entity resolution

Official-domain and subdomain results are directly attributable.

External results require both:

1. the normalized company name, and
2. the canonical domain

in the returned source content. A matching name alone is insufficient.

This rejected namesakes such as photography and storytelling businesses and conservatively rejected uncorroborated directory/news results.

## Deduplication

Deduplication now uses two complementary checks:

1. Same canonical source URL inside the evidence freshness window.
2. Equivalent normalized content after removing provider-added source URL footers.

Content comparison is URL-independent, so regional renderings of the same LinkedIn content do not create multiple evidence records.

`crawl_pages` is intentionally append-only. Invalid test evidence links were removed, while rejected immutable crawl payloads remain only as an audit trace and are not usable as company evidence.

## Research economics

Provider usage was recorded for every call:

- provider
- capability
- request ID
- status
- latency/runtime
- result count
- estimated cost
- actual cost when available
- environment/project/organization metadata

Tavily did not return credits or calculable actual cost for these responses. JYRA therefore retained the configured estimate rather than inventing an actual cost.

## Root causes and fixes

### Initial entity attribution was too permissive

Name-only matching admitted unrelated businesses with similar names.

**Fix:** external sources now require company-name and canonical-domain corroboration.

### Content hashes included provider-added source URL footers

Equivalent content on regional URLs could produce different hashes.

**Fix:** source URL footers are excluded from content hashing, and historical rows are compared using normalized content at read time.

### Different excerpts from the same fresh URL could duplicate evidence

Tavily can return query-specific excerpts for an already-observed page.

**Fix:** a same-source freshness-window check runs before insertion.

### Explicit refresh could create a second answered question

The research-question uniqueness invariant allows one answered question per project, company, question type, and capability.

**Fix:** explicit refresh now reuses the governed question record and increments its attempt count.

## Safety boundary

- Development database only
- Production untouched
- 7C Studio only
- No `COMPANY_DISCOVERY`
- No additional provider
- No Apify changes
- No signal-definition changes
- No score or weight changes
- No ICP changes
- No opportunity-state manipulation
- No fact auto-approval
- No direct signal creation

The test stopped after proving:

```text
Research Planner
  → Provider Router
  → Tavily WEB_SEARCH
  → external search results
  → attributable RAW evidence
```