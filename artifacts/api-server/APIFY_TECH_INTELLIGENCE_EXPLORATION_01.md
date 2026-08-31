# APIFY Technology Intelligence Exploration 01

## Final recommendation

**B: Actor is useful only for public website technology / MX information. Use selectively.**

This was a development-only, exploration-only run. Exactly three domains were
tested: Emergys, Cloudflare, and E2E Cloud. The Actor was not integrated into
JYRA and no database or production data was changed.

## Final summary

- Companies tested: 3
- Successful: 3
- Total technology observations: 20
- Public-web: 19
- Corporate IT: 1
- Product/application: 0
- Cloud infrastructure: 0
- Security stack: 0
- Unknown: 0
- MX/email coverage: 2/3
- Total cost: $0.000200 (ACTUAL_APIFY_RUN_USAGE)
- Cost/company: $0.000067
- Latency: 4679 ms
- Production operations: 0

## Actor and live input inspection

- Actor: `technicaldost~company-intelligence-api`
- Actor name: Company Tech-Stack & Domain Intelligence API
- Actor modified: 2026-08-30T19:42:21.141Z
- Latest build: 0.1.2
- Formal input schema endpoint available: NO
- Input contract source: live Actor metadata `exampleRunInput`
- Input used:

```json
{
  "domains": [
    "emergys.com",
    "cloudflare.com",
    "e2ecloud.com"
  ],
  "maxItems": 3
}
```

The Actor's metadata exposed `domains` and `maxItems`; those are the only
input parameters used. The formal schema endpoints returned 404 and are
recorded as unavailable rather than guessed.

## Per-company metrics

| Company | Domain | Status | Technologies | Public web | Corporate IT | Product/application | Cloud | Security | Unknown | MX/email |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| Emergys | emergys.com | SUCCESS | 12 | 11 | 1 | 0 | 0 | 0 | 0 | YES |
| Cloudflare | cloudflare.com | SUCCESS | 8 | 8 | 0 | 0 | 0 | 0 | 0 | YES |
| E2E Cloud | e2ecloud.com | SUCCESS | 0 | 0 | 0 | 0 | 0 | 0 | 0 | NO |

## Technology observation classification

Every observation defaults to **DETECTED**. A public website detection is not
treated as a company-wide product or security stack. Cloudflare/CDN/WAF
signals stay in public-web context, and AWS/Azure/GCP hosting signals do not
prove product infrastructure. MX/email observations are kept separate from
application infrastructure.

| Company | Technology | Raw Actor category | Detection basis | JYRA context | Relationship | Confidence | Useful for managed SOC | Reason |
|---|---|---|---|---|---|---|---|---|
| Emergys | jQuery | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Emergys | WordPress | cms | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Emergys | Google Analytics | analytics | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Emergys | Google Tag Manager | analytics | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Emergys | HubSpot | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Emergys | Cloudflare | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Emergys | Bootstrap | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Emergys | Font Awesome | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Emergys | Google Fonts | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Emergys | reCAPTCHA | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Emergys | HSTS | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Emergys | Microsoft 365 | UNKNOWN | DNS/MX/email output | CORPORATE_IT | DETECTED | UNKNOWN | MAYBE | DNS/MX/email observation is kept separate from application infrastructure; it may indicate corporate IT only. |
| Cloudflare | Astro | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Cloudflare | Google Analytics | analytics | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Cloudflare | Google Tag Manager | analytics | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Cloudflare | HubSpot | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Cloudflare | Zendesk | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Cloudflare | Cloudflare | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Cloudflare | Tailwind CSS | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |
| Cloudflare | HSTS | UNKNOWN | Actor public website intelligence output | MARKETING_WEB | DETECTED | UNKNOWN | NO | The Actor reports public website or hosting evidence; this does not prove the company product stack. |

## Returned fields and raw output

All raw dataset rows are preserved in `APIFY_TECH_INTELLIGENCE_EXPLORATION_01.json`. Returned field paths:

```
approxEmployees
companyName
description
dns
dns.a
dns.a[]
dns.mx
dns.mx[]
domain
domainRegisteredYear
emailProvider
emails
fetched
fetchedAt
foundedYear
foundedYearSource
funding
fundingStage
headcountRange
headcountSource
industry
logoUrl
poweredBy
server
socials
socials.facebook
socials.github
socials.instagram
socials.linkedin
socials.twitter
socials.youtube
statusCode
techStack
techStack.analytics
techStack.analytics[]
techStack.cms
techStack.cms[]
techStack.framework
techStack.framework[]
techStack.hosting_cdn
techStack.hosting_cdn[]
techStack.marketing
techStack.marketing[]
techStack.security
techStack.security[]
techStack.ui
techStack.ui[]
technologies
technologies[]
title
url
```

The machine-readable report also contains the normalized router response,
complete captured dataset payloads, per-company raw rows, and per-observation
raw values.

## Cost and provider activity

- Actual Actor runs: 1
- Domains processed: 3
- Successful domains: 3
- Failed domains: 0
- Actual cost: $0.000200
- Estimated cost: NOT USED
- Pricing source: Live Actor metadata pricingInfos
- Bright Data calls: 0
- Tavily calls: 0
- Exa calls: 0
- Other Apify Actors: 0

## Ratings

| Area | Rating |
|---|---|
| Public web tech | STRONG |
| Corporate IT | WEAK |
| Product/application | WEAK |
| Cloud infrastructure | WEAK |
| Security stack | WEAK |
| Managed SOC relevance | WEAK |
| Cost efficiency | STRONG |

## Safety

- Database writes: 0
- Canonical company updates: 0
- Facts: 0
- Signals: 0
- Opportunities: 0
- ICP changes: 0
- Contacts: 0
- Production operations: 0
