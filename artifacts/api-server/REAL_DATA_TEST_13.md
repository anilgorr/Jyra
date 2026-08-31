# JYRA Real Data Test 13 — End-to-End WHO Pipeline

## Final status

**PASS**

DECISION A: WHO PIPELINE PASSES. Firmographic qualification is sufficiently reliable for MVP. Move to WHEN/WHY.

This development-only test used exactly the 10-company Test 10–12 population.
Test 12 persisted verified LinkedIn identifiers were required and reused. The
run stopped at WHO qualification: no WHEN/WHY research, contacts, signals,
buying intent, opportunity scoring, or production operations were performed.

## Required summary

- COMPANIES: 10
- VERIFIED LINKEDIN BEFORE TEST: 10
- BRIGHT DATA ELIGIBLE: 10
- BRIGHT DATA REAL CALLS: 10
- CACHE HITS: 9
- SUCCESSFUL PROFILES: 10
- PARTIAL: 0
- NO RESULT: 0
- ERROR: 0
- CONFIRMED ENTITIES: 9
- PROBABLE: 0
- AMBIGUOUS: 0
- WRONG: 1
- INDUSTRY RESOLVED: 9
- GEOGRAPHY RESOLVED: 9
- EMPLOYEE SIZE RESOLVED: 9
- DOMAIN RESOLVED: 10
- FOUNDED RESOLVED: 8
- DESCRIPTION RESOLVED: 9
- LIKELY FIT: 5
- POSSIBLE FIT: 0
- LIKELY NOT FIT: 4
- INSUFFICIENT: 1
- ATTRIBUTE PROVENANCE: PASS
- ENTITY SAFETY: PASS
- UNSUPPORTED ATTRIBUTES: NO
- WRONG ENTITY ATTACHED: 0
- TAVILY NEW CALLS: 0
- EXA CALLS: 0
- APIFY CALLS: 0
- CONTACT CALLS: 0
- SIGNALS: 0
- BUYING INTENT: 0
- PRODUCTION OPERATIONS: 0

## Per-company results

| Company | Domain | Verified LinkedIn | Bright Data | Provider result | Entity | Industry | Employee range | LinkedIn employee count | HQ country | Geography match | Industry match | Size match | Final ICP status | Cost |
|---|---|---|---|---|---|---|---|---:|---|---|---|---|---|---:|
| Cloudflare | cloudflare.com | https://www.linkedin.com/company/cloudflare | CACHE | SUCCESS | CONFIRMED | Computer and Network Security | 1,001-5,000 employees | 8258 | United States | PASS | FAIL | PARTIAL | LIKELY_NOT_FIT | $0.0000 |
| Panopta | fortinet.com | https://www.linkedin.com/company/panopta-llc | CALL | SUCCESS | WRONG | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | INSUFFICIENT_DATA | $0.0015 |
| Amazon Web Services (AWS) | aws.amazon.com | https://www.linkedin.com/company/amazon-web-services | CACHE | SUCCESS | CONFIRMED | IT Services and IT Consulting | 10,001+ employees | 148019 | United States | PASS | PASS | FAIL | LIKELY_NOT_FIT | $0.0000 |
| Oracle Cloud | oracle.com | https://www.linkedin.com/company/oracle | CACHE | SUCCESS | CONFIRMED | IT Services and IT Consulting | 10,001+ employees | 207567 | United States | PASS | PASS | FAIL | LIKELY_NOT_FIT | $0.0000 |
| Alibaba Cloud | alibabacloud.com | https://www.linkedin.com/company/alibaba-cloud-computing-company | CACHE | SUCCESS | CONFIRMED | IT System Custom Software Development | 10,001+ employees | 5326 | China | FAIL | FAIL | FAIL | LIKELY_NOT_FIT | $0.0000 |
| E2E Cloud | e2enetworks.com | https://www.linkedin.com/company/e2enetworks | CACHE | SUCCESS | CONFIRMED | Technology, Information and Internet | 201-500 employees | 235 | India | PASS | PASS | PASS | LIKELY_FIT | $0.0000 |
| Cloud4C Services | cloud4c.com | https://www.linkedin.com/company/cloud4c | CACHE | SUCCESS | CONFIRMED | Information Technology & Services | 1,001-5,000 employees | 1700 | Singapore | PASS | PASS | PARTIAL | LIKELY_FIT | $0.0000 |
| Emergys | emergys.com | https://www.linkedin.com/company/emergys-llc | CACHE | SUCCESS | CONFIRMED | IT Services and IT Consulting | 1,001-5,000 employees | 1414 | United States | PASS | PASS | PARTIAL | LIKELY_FIT | $0.0000 |
| ENTUNE IT Consulting Pvt Ltd | entune.co | https://www.linkedin.com/company/entune | CACHE | SUCCESS | CONFIRMED | IT Services and IT Consulting | 51-200 employees | 113 | India | PASS | PASS | PARTIAL | LIKELY_FIT | $0.0000 |
| Cloudi | cloudi-infra.com | https://www.linkedin.com/company/cloudi-infra | CACHE | SUCCESS | CONFIRMED | IT Services and IT Consulting | 51-200 employees | 32 | India | PASS | PASS | PARTIAL | LIKELY_FIT | $0.0000 |

## Before / after comparison

| Metric | Test 10 baseline | Test 13 |
|---|---:|---:|
| Geography resolved | 1/10 | 9/10 |
| Industry resolved | 2/10 | 9/10 |
| Employee size resolved | 1/10 | 9/10 |
| Likely fit | 0 | 5 |
| Possible fit | 2 | 0 |
| Likely not fit | 1 | 4 |
| Insufficient | 7 | 1 |

## Cost and idempotency

- Profile resolution cost (Test 12): $0.09 estimated
- Test 13 Bright Data cost: $0.0150
- Complete WHO cost: $0.1050
- Average WHO cost/company: $0.0105
- Cost/successful profile: $0.0015
- Cost/safely qualified company: $0.0030
- First-run Bright Data calls: 1
- First-run Bright Data cache hits: 9
- Second-run Bright Data calls: 1
- Second-run cache hits: 9
- Second-run Tavily calls: 0

## Entity and attribute audit

### Cloudflare

- Verified LinkedIn: https://www.linkedin.com/company/cloudflare
- Bright Data request provenance: RESOLVER_VERIFIED
- Returned LinkedIn: null
- Returned domain: cloudflare.com
- Entity status: CONFIRMED (98)
- Match reasons: + Requested LinkedIn URL has trusted resolver verified provenance; - Bright Data did not echo the LinkedIn URL; + Returned company name matches the requested company; + Returned official domain exactly agrees with canonical identity; + Returned geography agrees with canonical identity; + No material contradictory identity evidence
- Returned attributes: company name, website, canonical domain, industry, employee range, LinkedIn employee count, HQ country, HQ region/state, HQ city, founded year, description, specialties, followers
- Missing/unknown attributes: NONE
- ICP reason: Geography matches United States; Employee size 1,001-5,000 employees overlaps the target range; size fit is partial; Verified industry Computer and Network Security is outside the accepted industries
- Canonical update: NO
- Attribute provenance: true

### Panopta

- Verified LinkedIn: https://www.linkedin.com/company/panopta-llc
- Bright Data request provenance: RESOLVER_VERIFIED
- Returned LinkedIn: null
- Returned domain: panopta.com
- Entity status: WRONG (5)
- Match reasons: + Requested LinkedIn URL has trusted resolver verified provenance; - Bright Data did not echo the LinkedIn URL; + Returned company name matches the requested company; - Returned company name or official domain materially contradicts canonical identity
- Returned attributes: company name, website, canonical domain, industry, employee range, LinkedIn employee count, HQ country, HQ region/state, HQ city, founded year, description, specialties, followers
- Missing/unknown attributes: headquarters geography, primary industry, employee size
- ICP reason: Insufficient known ICP dimensions
- Canonical update: NO
- Attribute provenance: true

### Amazon Web Services (AWS)

- Verified LinkedIn: https://www.linkedin.com/company/amazon-web-services
- Bright Data request provenance: USER_VERIFIED
- Returned LinkedIn: null
- Returned domain: aws.amazon.com
- Entity status: CONFIRMED (90)
- Match reasons: + Requested LinkedIn URL has trusted user verified provenance; - Bright Data did not echo the LinkedIn URL; + Returned company name matches the requested company; + Strong exact company-name agreement independently corroborates the trusted requested profile; + No material contradictory identity evidence
- Returned attributes: company name, website, canonical domain, industry, employee range, LinkedIn employee count, HQ country, HQ region/state, HQ city, founded year, description, followers
- Missing/unknown attributes: NONE
- ICP reason: Geography matches United States; Industry matches IT Services and IT Consulting; Verified employee size 10,001+ employees is outside the target range
- Canonical update: YES
- Attribute provenance: true

### Oracle Cloud

- Verified LinkedIn: https://www.linkedin.com/company/oracle
- Bright Data request provenance: RESOLVER_VERIFIED
- Returned LinkedIn: null
- Returned domain: oracle.com
- Entity status: CONFIRMED (98)
- Match reasons: + Requested LinkedIn URL has trusted resolver verified provenance; - Bright Data did not echo the LinkedIn URL; + Returned company name matches the requested company; + Returned official domain exactly agrees with canonical identity; + No material contradictory identity evidence
- Returned attributes: company name, website, canonical domain, industry, employee range, LinkedIn employee count, HQ country, HQ region/state, HQ city, founded year, description, followers
- Missing/unknown attributes: NONE
- ICP reason: Geography matches United States; Industry matches IT Services and IT Consulting; Verified employee size 10,001+ employees is outside the target range
- Canonical update: YES
- Attribute provenance: true

### Alibaba Cloud

- Verified LinkedIn: https://www.linkedin.com/company/alibaba-cloud-computing-company
- Bright Data request provenance: RESOLVER_VERIFIED
- Returned LinkedIn: null
- Returned domain: alibabacloud.com
- Entity status: CONFIRMED (98)
- Match reasons: + Requested LinkedIn URL has trusted resolver verified provenance; - Bright Data did not echo the LinkedIn URL; + Returned company name matches the requested company; + Returned official domain exactly agrees with canonical identity; + No material contradictory identity evidence
- Returned attributes: company name, website, canonical domain, industry, employee range, LinkedIn employee count, HQ country, HQ city, description, specialties, followers
- Missing/unknown attributes: NONE
- ICP reason: Verified geography China is outside the accepted geographies; Verified industry IT System Custom Software Development is outside the accepted industries; Verified employee size 10,001+ employees is outside the target range
- Canonical update: YES
- Attribute provenance: true

### E2E Cloud

- Verified LinkedIn: https://www.linkedin.com/company/e2enetworks
- Bright Data request provenance: RESOLVER_VERIFIED
- Returned LinkedIn: null
- Returned domain: e2enetworks.com
- Entity status: CONFIRMED (98)
- Match reasons: + Requested LinkedIn URL has trusted resolver verified provenance; - Bright Data did not echo the LinkedIn URL; + Returned company name matches the requested company; + Returned official domain exactly agrees with canonical identity; + No material contradictory identity evidence
- Returned attributes: company name, website, canonical domain, industry, employee range, LinkedIn employee count, HQ country, HQ region/state, HQ city, founded year, description, specialties, followers
- Missing/unknown attributes: NONE
- ICP reason: Geography matches India; Industry matches Technology, Information and Internet; Employee size 201-500 employees is within the target range
- Canonical update: YES
- Attribute provenance: true

### Cloud4C Services

- Verified LinkedIn: https://www.linkedin.com/company/cloud4c
- Bright Data request provenance: RESOLVER_VERIFIED
- Returned LinkedIn: null
- Returned domain: cloud4c.com
- Entity status: CONFIRMED (98)
- Match reasons: + Requested LinkedIn URL has trusted resolver verified provenance; - Bright Data did not echo the LinkedIn URL; + Returned company name matches the requested company; + Returned official domain exactly agrees with canonical identity; + No material contradictory identity evidence
- Returned attributes: company name, website, canonical domain, industry, employee range, LinkedIn employee count, HQ country, HQ city, founded year, description, specialties, followers
- Missing/unknown attributes: NONE
- ICP reason: Geography matches Singapore; Industry matches Information Technology & Services; Employee size 1,001-5,000 employees overlaps the target range; size fit is partial
- Canonical update: YES
- Attribute provenance: true

### Emergys

- Verified LinkedIn: https://www.linkedin.com/company/emergys-llc
- Bright Data request provenance: RESOLVER_VERIFIED
- Returned LinkedIn: null
- Returned domain: emergys.com
- Entity status: CONFIRMED (98)
- Match reasons: + Requested LinkedIn URL has trusted resolver verified provenance; - Bright Data did not echo the LinkedIn URL; + Returned company name matches the requested company; + Returned official domain exactly agrees with canonical identity; + No material contradictory identity evidence
- Returned attributes: company name, website, canonical domain, industry, employee range, LinkedIn employee count, HQ country, HQ region/state, HQ city, founded year, description, specialties, followers
- Missing/unknown attributes: NONE
- ICP reason: Geography matches United States; Industry matches IT Services and IT Consulting; Employee size 1,001-5,000 employees overlaps the target range; size fit is partial
- Canonical update: YES
- Attribute provenance: true

### ENTUNE IT Consulting Pvt Ltd

- Verified LinkedIn: https://www.linkedin.com/company/entune
- Bright Data request provenance: RESOLVER_VERIFIED
- Returned LinkedIn: null
- Returned domain: entune.co
- Entity status: CONFIRMED (98)
- Match reasons: + Requested LinkedIn URL has trusted resolver verified provenance; - Bright Data did not echo the LinkedIn URL; + Returned company name matches the requested company; + Returned official domain exactly agrees with canonical identity; + No material contradictory identity evidence
- Returned attributes: company name, website, canonical domain, industry, employee range, LinkedIn employee count, HQ country, HQ region/state, HQ city, founded year, description, specialties, followers
- Missing/unknown attributes: NONE
- ICP reason: Geography matches India; Industry matches IT Services and IT Consulting; Employee size 51-200 employees overlaps the target range; size fit is partial
- Canonical update: YES
- Attribute provenance: true

### Cloudi

- Verified LinkedIn: https://www.linkedin.com/company/cloudi-infra
- Bright Data request provenance: RESOLVER_VERIFIED
- Returned LinkedIn: null
- Returned domain: cloudi-infra.com
- Entity status: CONFIRMED (98)
- Match reasons: + Requested LinkedIn URL has trusted resolver verified provenance; - Bright Data did not echo the LinkedIn URL; + Returned company name matches the requested company; + Returned official domain exactly agrees with canonical identity; + No material contradictory identity evidence
- Returned attributes: company name, website, canonical domain, industry, employee range, LinkedIn employee count, HQ country, HQ region/state, HQ city, founded year, description, followers
- Missing/unknown attributes: NONE
- ICP reason: Geography matches India; Industry matches IT Services and IT Consulting; Employee size 51-200 employees overlaps the target range; size fit is partial
- Canonical update: YES
- Attribute provenance: true

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
  "brightDataCalls": 2,
  "tavilyCalls": 0,
  "exaCalls": 0,
  "apifyCalls": 0,
  "contactCalls": 0,
  "signals": 0,
  "buyingIntent": 0,
  "productionOperations": 0,
  "unsupportedAttributesCreated": 0,
  "canonicalUpdates": 8
}
```

## Decision

DECISION A: WHO PIPELINE PASSES. Firmographic qualification is sufficiently reliable for MVP. Move to WHEN/WHY.
