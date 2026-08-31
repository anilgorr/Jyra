# JYRA Real Data Test 11 — Bright Data Company Firmographics Quality Validation

## Final status

**PASS**

DECISION B: BRIGHT DATA FIRMOGRAPHIC QUALITY PASSES WHEN GIVEN A LINKEDIN URL; IDENTIFIER RESOLUTION IS THE NEXT BOTTLENECK

This test used exactly the 10-company population from Real Data Test 10 and evaluated
WHO/company qualification only. Missing LinkedIn identifiers were blocked without
discovery or fallback calls. No contacts, signals, opportunity research, WHEN/WHY
research, ICP changes, or production operations were performed.

## Test population

**10 companies, unchanged from Test 10**

1. Cloudflare — snapshot identifier `test-11:cloudflare`
2. Panopta — snapshot identifier `test-11:panopta`
3. Amazon Web Services (AWS) — snapshot identifier `test-11:amazon-web-services-aws`
4. Oracle Cloud — snapshot identifier `test-11:oracle-cloud`
5. Alibaba Cloud — snapshot identifier `test-11:alibaba-cloud`
6. E2E Cloud — snapshot identifier `test-11:e2e-cloud`
7. Cloud4C Services — snapshot identifier `test-11:cloud4c-services`
8. Emergys — snapshot identifier `test-11:emergys`
9. ENTUNE IT Consulting Pvt Ltd — snapshot identifier `test-11:entune-it-consulting-pvt-ltd`
10. Cloudi — snapshot identifier `test-11:cloudi`

## Before / after table

Before values are the recorded Test 10 after-state; after values are safe Test 11
qualification values. Non-confirmed provider observations were not attached.

| Company | LinkedIn identifier | BEFORE: domain / geography / industry / employee size / ICP | AFTER: domain / geography / industry / employee size / ICP | Bright Data | Entity status | Attributes returned | Conflicts | Call cost | Qualified for WHEN/WHY |
|---|---|---|---|---|---|---|---|---:|---|
| Cloudflare | NO_LINKEDIN_URL | cloudflare.com / United States / UNKNOWN / 4,200+ / LIKELY_NOT_FIT | cloudflare.com / United States / UNKNOWN / 4,200+ / LIKELY_NOT_FIT | BLOCKED | NOT_RUN | NONE | NO | $0.0000 | NO |
| Panopta | NO_LINKEDIN_URL | fortinet.com / UNKNOWN / SaaS / UNKNOWN / POSSIBLE_FIT | fortinet.com / UNKNOWN / SaaS / UNKNOWN / POSSIBLE_FIT | BLOCKED | NOT_RUN | NONE | NO | $0.0000 | NO |
| Amazon Web Services (AWS) | PROBABLE_LINKEDIN_URL | UNKNOWN / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | UNKNOWN / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | CACHE_HIT | PROBABLE | canonical domain, company name, industry, employee range, LinkedIn employee count, founded year, company description, followers, website | NO | $0.0000 | NO |
| Oracle Cloud | NO_LINKEDIN_URL | oracle.com / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | oracle.com / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | BLOCKED | NOT_RUN | NONE | NO | $0.0000 | NO |
| Alibaba Cloud | NO_LINKEDIN_URL | alibabacloud.com / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | alibabacloud.com / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | BLOCKED | NOT_RUN | NONE | NO | $0.0000 | NO |
| E2E Cloud | NO_LINKEDIN_URL | e2enetworks.com / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | e2enetworks.com / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | BLOCKED | NOT_RUN | NONE | NO | $0.0000 | NO |
| Cloud4C Services | NO_LINKEDIN_URL | cloud4c.com / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | cloud4c.com / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | BLOCKED | NOT_RUN | NONE | NO | $0.0000 | NO |
| Emergys | NO_LINKEDIN_URL | emergys.com / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | emergys.com / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | BLOCKED | NOT_RUN | NONE | NO | $0.0000 | NO |
| ENTUNE IT Consulting Pvt Ltd | NO_LINKEDIN_URL | entune.co / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | entune.co / UNKNOWN / UNKNOWN / UNKNOWN / INSUFFICIENT_DATA | BLOCKED | NOT_RUN | NONE | NO | $0.0000 | NO |
| Cloudi | NO_LINKEDIN_URL | cloudi-infra.com / UNKNOWN / IT services / UNKNOWN / POSSIBLE_FIT | cloudi-infra.com / UNKNOWN / IT services / UNKNOWN / POSSIBLE_FIT | BLOCKED | NOT_RUN | NONE | NO | $0.0000 | NO |

## Coverage

### All 10 companies

- LinkedIn URL available: 1/10
- Industry resolved: 2/10
- Geography resolved: 1/10
- Employee size resolved: 1/10
- Domain resolved: 9/10
- Domain resolved or safely unknown: 10/10

### Bright Data-eligible companies only

- Eligible: 1
- Successful profiles: 1/1
- Strong raw firmographic profiles: 1/1
- Confirmed entities: 0/1
- Industry: 0/1
- Geography: 0/1
- Employee size: 0/1
- Website/domain: 0/1

## Required summary

- TEST POPULATION: 10
- LINKEDIN COMPANY URL AVAILABLE: 1/10
- BRIGHT DATA ELIGIBLE: 1/10
- BRIGHT DATA REAL CALLS: 1
- CACHE HITS: 1
- SUCCESSFUL PROFILES: 1
- NO RESULT: 0
- PARTIAL PROFILES: 0
- CONFIRMED ENTITIES: 0
- PROBABLE: 1
- AMBIGUOUS: 0
- WRONG: 0
- DOMAIN RESOLVED: 9
- GEOGRAPHY RESOLVED: 1
- INDUSTRY RESOLVED: 2
- EMPLOYEE SIZE RESOLVED: 1
- FOUNDED YEAR RESOLVED: 0
- DESCRIPTION RESOLVED: 0
- LIKELY FIT: 0
- POSSIBLE FIT: 2
- LIKELY NOT FIT: 1
- INSUFFICIENT DATA: 7
- QUALIFIED FOR WHEN/WHY: 0
- TOTAL ESTIMATED COST: $0.0015
- AVERAGE COST/COMPANY: $0.0002
- AVERAGE COST/SUCCESSFUL PROFILE: $0.0015
- TEST 10 COST: $0.19
- COVERAGE IMPROVEMENT: FAIL
- FIRMOGRAPHIC RETRIEVAL QUALITY WHEN URL EXISTS: PASS
- SAFE ENTITY ACCEPTANCE: FAIL
- LINKEDIN IDENTIFIER COVERAGE: FAIL
- COST EFFICIENCY: PASS
- ENTITY SAFETY: PASS
- ATTRIBUTE PROVENANCE: PASS
- UNSUPPORTED ATTRIBUTES: NO
- BUYING INTENT CREATED: NO
- SIGNALS CREATED: 0
- EXA CALLS: 0
- TAVILY CALLS: 0
- APIFY CALLS: 0
- CONTACT ENRICHMENT: 0
- PRODUCTION OPERATIONS: 0

## Idempotency test

- First-run Bright Data calls: 1
- Second-run Bright Data calls: 0
- Cache hits during idempotency replay: 1
- The persisted successful result was reused without another Bright Data request.
- Persisted prior-run Bright Data calls observed before this run: 1
- Persisted-cache rerun Bright Data calls in this run: 0
- Persisted-cache rerun result: true

## Entity match reasons

### Cloudflare — NOT_RUN

- Bright Data lookup blocked because no LinkedIn company URL exists in the Test 10 identifier snapshot

### Panopta — NOT_RUN

- Bright Data lookup blocked because no LinkedIn company URL exists in the Test 10 identifier snapshot

### Amazon Web Services (AWS) — PROBABLE

- - Requested LinkedIn URL does not have strong provenance

- - Bright Data did not echo the LinkedIn URL

- + Returned company name matches the requested company

### Oracle Cloud — NOT_RUN

- Bright Data lookup blocked because no LinkedIn company URL exists in the Test 10 identifier snapshot

### Alibaba Cloud — NOT_RUN

- Bright Data lookup blocked because no LinkedIn company URL exists in the Test 10 identifier snapshot

### E2E Cloud — NOT_RUN

- Bright Data lookup blocked because no LinkedIn company URL exists in the Test 10 identifier snapshot

### Cloud4C Services — NOT_RUN

- Bright Data lookup blocked because no LinkedIn company URL exists in the Test 10 identifier snapshot

### Emergys — NOT_RUN

- Bright Data lookup blocked because no LinkedIn company URL exists in the Test 10 identifier snapshot

### ENTUNE IT Consulting Pvt Ltd — NOT_RUN

- Bright Data lookup blocked because no LinkedIn company URL exists in the Test 10 identifier snapshot

### Cloudi — NOT_RUN

- Bright Data lookup blocked because no LinkedIn company URL exists in the Test 10 identifier snapshot

## Root-cause classification

Every missing final attribute is classified per company in `REAL_DATA_TEST_11_RESULT.json`.
Categories include `NO_LINKEDIN_IDENTIFIER`, `INVALID_LINKEDIN_URL`,
`BRIGHT_DATA_NO_RESULT`, `BRIGHT_DATA_PARTIAL_PROFILE`,
`ENTITY_PROBABLE_UNSAFE_TO_ATTACH`, `ENTITY_AMBIGUOUS_UNSAFE_TO_ATTACH`,
`ENTITY_WRONG_UNSAFE_TO_ATTACH`, and `FIELD_NOT_RETURNED`.

## Attribute provenance

Accepted returned attributes preserve Bright Data as retrieval provider, LinkedIn as
publisher, request profile URL separately from returned profile URL, retrieval time,
raw value, normalized value, entity confidence, and attribute confidence.

## Safety

```json
{
  "databaseDeltas": {
    "researchJobs": 0,
    "evidenceRows": 0,
    "contactEnrichmentAttempts": 0,
    "signals": 0,
    "opportunityScores": 0,
    "companies": 0,
    "projectCompanies": 0
  },
  "externalQualificationCalls": 0,
  "providerCallCounts": {
    "bright_data": 1
  },
  "exaCalls": 0,
  "tavilyCalls": 0,
  "apifyCalls": 0,
  "contactEnrichment": 0,
  "signalsCreated": 0,
  "opportunityScoresCreated": 0,
  "buyingIntentCreated": 0,
  "whenWhyResearch": 0,
  "productionOperations": 0,
  "unsupportedAttributesCreated": 0,
  "testRouterProviderCount": 1,
  "providerUsageEvents": 1,
  "canonicalCompanyUpdates": 0
}
```

## Decision

DECISION B: BRIGHT DATA FIRMOGRAPHIC QUALITY PASSES WHEN GIVEN A LINKEDIN URL; IDENTIFIER RESOLUTION IS THE NEXT BOTTLENECK

Measured result: 1/10 companies had usable existing LinkedIn company
identifiers. For 1 eligible company, 1
returned a strong raw firmographic profile. The initial Test 11 run made
1 real Bright Data call, the persisted-cache rerun made
0, and total estimated cost was $0.0015.
This does not justify adding a second firmographic provider while identifier
coverage is low.

STOP: Test 11 complete. No fallback, identifier resolution, WHEN/WHY, contacts,
signals, opportunity research, or production operations were performed.
