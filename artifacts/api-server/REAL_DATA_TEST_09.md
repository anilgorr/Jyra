# JYRA Real Data Test 09 — Company Discovery Quality

## Final status

**TECHNICAL PIPELINE: PASS**  
**DISCOVERY QUALITY: FAIL**  
**OVERALL TEST: FAIL**

## Assessment

The technical path returned candidates, but the returned universe is not sufficiently aligned with the accepted ICP from known attributes alone.

Queries were neutral company-description queries. They did not include the
offering name, buying intent, security pain, urgency, vendor-search language,
Tavily, Apify, people search, contact enrichment, fact extraction, signals, or
opportunity scoring.

## Query performance

| Query | Raw results | Unique companies | Strong ICP | Plausible ICP | Weak ICP | Insufficient data |
|---|---:|---:|---:|---:|---:|---:|
| SaaS company with significant significant cloud/IT infrastructure | 10 | 10 | 0 | 0 | 0 | 10 |
| technology company serving enterprise customers with cloud-based infrastructure | 10 | 10 | 0 | 0 | 0 | 10 |
| IT services company serving mid-market or enterprise customers | 10 | 10 | 0 | 0 | 0 | 10 |
| fintech company operating significant significant cloud/IT infrastructure | 10 | 10 | 0 | 0 | 0 | 10 |

## Manual-review table

| Company | Canonical domain | Original Exa URL | Geography | Industry | Employee size | Entity status | ICP qualification | Discovery quality | Why in market | Query found by | Existing / new |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Cloudflare | cloudflare.com | https://cloudflare.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | SaaS company with significant significant cloud/IT infrastructure<br>technology company serving enterprise customers with cloud-based infrastructure | NEW |
| Panopta | fortinet.com | https://fortinet.com/products/fortimonitor | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | SaaS company with significant significant cloud/IT infrastructure | NEW |
| 21Vianet Blue Cloud | 21vbluecloud.com | https://21vbluecloud.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | SaaS company with significant significant cloud/IT infrastructure<br>technology company serving enterprise customers with cloud-based infrastructure | NEW |
| E2E Cloud | e2enetworks.com | https://e2enetworks.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | SaaS company with significant significant cloud/IT infrastructure<br>technology company serving enterprise customers with cloud-based infrastructure | NEW |
| Warren Cloud Infrastructure Platform | warren.io | https://warren.io | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | SaaS company with significant significant cloud/IT infrastructure | NEW |
| Cloud4C Services | cloud4c.com | https://cloud4c.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | SaaS company with significant significant cloud/IT infrastructure | NEW |
| EdgeCore Digital Infrastructure | edgecore.com | https://edgecore.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | SaaS company with significant significant cloud/IT infrastructure | NEW |
| GrandTech Cloud Services Inc. | grandtechcloud.com | https://grandtechcloud.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | SaaS company with significant significant cloud/IT infrastructure | NEW |
| NeevCloud® | neevcloud.com | https://neevcloud.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | SaaS company with significant significant cloud/IT infrastructure | NEW |
| CloudHQ, LLC | cloudhq.com | https://cloudhq.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | SaaS company with significant significant cloud/IT infrastructure | NEW |
| Alibaba Cloud | alibabacloud.com | https://alibabacloud.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | technology company serving enterprise customers with cloud-based infrastructure | NEW |
| Oracle Cloud | oracle.com | https://oracle.com/cloud | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | technology company serving enterprise customers with cloud-based infrastructure | NEW |
| Amazon Web Services (AWS) | UNKNOWN | https://linkedin.com/company/amazon-web-services | UNKNOWN | UNKNOWN | UNKNOWN | PROBABLE_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | technology company serving enterprise customers with cloud-based infrastructure | NEW |
| IBM Hybrid Cloud and Infrastructure | ibm.com | https://ibm.com/solutions/it-infrastructure | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | technology company serving enterprise customers with cloud-based infrastructure | NEW |
| IT-Conductor Inc. | itconductor.com | https://itconductor.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | technology company serving enterprise customers with cloud-based infrastructure | NEW |
| Cloudi | cloudi-infra.com | https://cloudi-infra.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | technology company serving enterprise customers with cloud-based infrastructure | NEW |
| Emergys | emergys.com | https://emergys.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | IT services company serving mid-market or enterprise customers | NEW |
| Value Stream Systems | valuestreamsystems.com | https://valuestreamsystems.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | IT services company serving mid-market or enterprise customers | NEW |
| Meridian IT Inc. | meridianitinc.com | https://meridianitinc.com | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | IT services company serving mid-market or enterprise customers | NEW |
| ENTUNE IT Consulting Pvt Ltd | entune.co | https://entune.co | UNKNOWN | UNKNOWN | UNKNOWN | CONFIRMED_ENTITY | INSUFFICIENT_DATA | INSUFFICIENT DATA | Identity is available; geography, industry, employee size remain unknown. | IT services company serving mid-market or enterprise customers | NEW |

## Quality summary

| Metric | Count |
|---|---:|
| Exa calls | 4 |
| Raw results | 40 |
| Unique raw entities | 37 |
| Confirmed entities | 19 |
| Probable entities | 1 |
| Ambiguous entities | 0 |
| Wrong entity | 0 |
| Duplicates | 3 |
| Canonical companies | 20 |
| Strong ICP candidates | 0 |
| Plausible ICP candidates | 0 |
| Weak ICP candidates | 0 |
| Insufficient data | 20 |
| Tavily calls | 0 |
| Apify calls | 0 |
| Contact calls | 0 |
| Signals created | 0 |
| Opportunity scores created | 0 |
| Production operations | 0 |

## Safety

```json
{
  "databaseDeltas": {
    "researchJobs": 0,
    "evidenceRows": 0,
    "contactEnrichmentAttempts": 0,
    "signals": 0,
    "opportunityScores": 0
  },
  "productionOperations": 0,
  "tavilyCalls": 0,
  "apifyCalls": 0,
  "contactCalls": 0,
  "signalsCreated": 0,
  "opportunityScoresCreated": 0
}
```

The complete raw projections, normalized candidates, dedupe records, and
quality explanations are in `REAL_DATA_TEST_09_RESULT.json`.
