# JYRA Providers

## Implemented provider boundary

JYRA business logic requests a capability through the `ProviderRouter`; it does
not import a vendor SDK or depend on a vendor response shape. The implemented
capabilities are:

- `COMPANY_DISCOVERY`
- `COMPANY_LOOKUP`
- `WEB_SEARCH`
- `WEBSITE_CRAWL`
- `JOB_SEARCH`
- `NEWS_SEARCH`
- `TECH_STACK`
- `LEADERSHIP_SEARCH`
- `PUBLIC_SOCIAL_SEARCH`
- `PERSON_LOOKUP`
- `EMAIL_LOOKUP`
- `PHONE_LOOKUP`

The router exposes JYRA-owned methods including `discoverCompanies()`,
`lookupCompany()`, `searchWeb()`, `crawlWebsite()`, `getJobs()`,
`searchNews()`, `detectTechnology()`, `findLeadership()`, `findPeople()`,
`lookupPerson()`, `findEmail()`, and `findPhone()`.

## Deterministic selection and fallback

Only enabled providers that declare the requested capability are eligible.
Candidates use this stable ordering:

1. lower configured priority
2. lower estimated cost
3. higher quality score
4. higher configured success rate
5. lower average latency
6. provider name and ID as final deterministic tie-breakers

An adapter failure falls back to the next candidate only when the normalized
error is explicitly retryable. Empty results are successful observations of
missing provider data and do not trigger fallback. A non-retryable error stops
the route.

Every attempted provider call must write `provider_usage`, including the selected
capability, normalized status, retryability, latency, estimated and actual
cost, and error code. A usage persistence failure fails the routing call rather
than silently returning an unaccounted result. Provider success/failure
timestamps are updated separately from commercial interpretation. Success
rate, cost, quality, and latency are routing configuration in this milestone;
automatic aggregation is future work.

## Provider router goals

The provider router:

1. Ask the cheapest viable source first.
2. Reuse public intelligence where permitted.
3. Spend more only when more information could change a company decision.
4. Record request status, latency, cost, and result provenance.
5. Apply deterministic retry, timeout, budget, and stopping rules.

## Provider categories

Future production adapters may cover:

- company and website discovery
- public web and news research
- hiring and job-posting evidence
- funding and corporate events
- technology and infrastructure signals
- business directories
- contact enrichment

Specific providers must be selected only after their terms, fields, rate limits, and data provenance are understood.

## Adapter contract

Each adapter accepts a typed JYRA capability request and returns:

- provider request ID
- normalized status
- normalized capability data
- source references
- usage and cost metadata
- retryability
- captured timestamp

Vendor-specific fields stay behind adapters. Adapters must not directly write
commercial interpretations, signals, scores, or opportunities.

## Deterministic mock adapters

This milestone includes mock adapters for `WEB_SEARCH`, `WEBSITE_CRAWL`, and
`JOB_SEARCH`. Their outputs use `mock://` references and explicitly label
themselves as deterministic mock output, not external evidence. Tests can
configure success, empty, retryable failure, or terminal failure without
network access.

No production provider, credential, paid API, scraper, or Apify Actor is
configured by this milestone.

## Safety rules

- Never fabricate a provider response.
- Never treat a provider timeout as a negative finding.
- Do not enrich people before company qualification.
- Do not expose one customer’s private interpretation to another customer.
- Keep credentials in Replit Secrets or a managed integration, never in source control.