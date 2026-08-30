# JYRA HOTFIX 06 — Exa COMPANY_DISCOVERY Provider

## Required result

**ROOT CAUSE:** Provider Diagnostics was showing historical failures from the former raw connector-proxy implementation. After the adapter moved to direct `exa-js`, no real routed request had been made, so `lastSuccessAt` remained empty and the health rule correctly continued to report `FAILING`. The previous raw-proxy request returned HTTP 400; its adapter discarded the Exa response body, so no more specific historical Exa message can be recovered without guessing.

**ENDPOINT USED:** `POST https://api.exa.ai/search` through `exa-js`

**HTTP STATUS BEFORE FIX:** 400 (historical raw connector request)

**EXA ERROR BEFORE FIX:** `Exa rejected this request` / `PROVIDER_REQUEST_FAILED`. The original Exa body was not retained.

**CODE/CONFIGURATION CHANGE:** Use direct `exa-js` Search with a server-side `EXA_API_KEY`; force raw company-category retrieval; recalculate provider success rate and average latency from usage records.

**SDK VERSION:** 2.19.0

**TEST QUERY:** SaaS company cloud infrastructure

**CATEGORY:** company

**SEARCH TYPE:** auto

**REQUEST PARAMETERS (API key excluded):**

```json
{
  "type": "auto",
  "category": "company",
  "numResults": 3
}
```

**LIVE RESPONSE STATUS:** success

**LIVE ERROR:** None

**SANITIZED RESPONSE:**

```json
{
  "status": "success",
  "providerRequestId": "hotfix-06:2026-08-30T08:36:06.896Z:b220e720-6d21-4c7a-badf-3aec920febca",
  "resultCount": 3,
  "error": null,
  "shape": {
    "topLevel": [
      "status",
      "providerId",
      "providerRequestId",
      "data",
      "sources",
      "usage",
      "error",
      "capturedAt",
      "metadata"
    ],
    "company": [
      "name",
      "domain",
      "website",
      "description",
      "industry",
      "location",
      "employeeCount",
      "employeeRange",
      "linkedinUrl",
      "sourceUrl",
      "relevanceScore",
      "providerMetadata"
    ]
  }
}
```

**RESULT COUNT:** 3

**RESULTS:**

1. Nubosas — URL: https://nubosas.com; domain: nubosas.com; provider result ID: https://exa.ai/library/organization/wmgnn2yrk5j
2. InfraVault — LinkedIn company URL: https://linkedin.com/company/infravault; canonical domain: UNKNOWN; provider result ID: https://exa.ai/library/organization/3r1h9bzfzlt
3. 21Vianet Blue Cloud — URL: https://21vbluecloud.com; domain: 21vbluecloud.com; provider result ID: https://exa.ai/library/organization/knhs4lsswmv

**LAST SUCCESS:** 2026-08-30T08:36:07.970Z

**PROVIDER HEALTH:** HEALTHY

**SUCCESS RATE:** 25.0%

**OBSERVED LATENCY:** 1013 ms

**REAL EXA API CALL:** PASS

**COMPANY RECORDS CREATED:** 0

**TAVILY CALLS:** 0

**APIFY CALLS:** 0

**PRODUCTION OPERATIONS:** 0

**FINAL STATUS:** PASS

## Post-verification URL classification correction

The health test exposed that a company-category result can point to a platform
profile rather than an official website. JYRA now classifies known platform
domains before canonical-domain extraction. The original Exa URL remains in
provider provenance; LinkedIn URLs populate the LinkedIn/profile fields; and
domain resolution remains `UNKNOWN` unless the bounded `COMPANY_LOOKUP`
workflow returns a sufficiently verified non-platform domain.
