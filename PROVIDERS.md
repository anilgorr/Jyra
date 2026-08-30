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

`COMPANY_DISCOVERY` finds candidates not already stored in JYRA. Apify configurations may supply a dedicated discovery actor ID; returned rows are normalized into name, domain, website, and description before canonical identity resolution. Missing configuration is reported as blocked and is never replaced with fabricated candidates.
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

Every attempted provider call must write `provider_usage`, including the
selected capability, normalized status, retryability, latency, runtime, result
count, estimated and actual cost, and error code. A usage persistence failure
fails the routing call rather
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

## Apify research adapter

Apify is implemented as a production provider adapter through Replit's managed
`apify` connection. Application code never reads an Apify token. The adapter:

- starts an Actor through the authenticated server-side proxy
- polls its run with a bounded timeout and bounded retry/backoff
- retrieves the default dataset using offset/limit pagination
- records Apify runtime, result count, reported spend, status, retryability,
  error code, run ID, and dataset ID
- normalizes Actor output into JYRA-owned crawl, jobs, web-search, technology,
  or public-social result types

Actor IDs live only in the provider's opaque `configuration.actorIds` object.
Changing an Actor is a configuration update and does not require changing the
adapter. Blank and unsupported Actor mappings are ignored.

The development database contains a disabled Apify placeholder. It has no
capability mappings and no Actor IDs by default. JYRA does not enable a
capability until a reliable Actor has been evaluated and its ID is deliberately
saved in provider configuration. The managed connection itself has been
verified with a safe authenticated Apify account call.

The authenticated `/api/workspace/providers/diagnostics` endpoint and its
development-only settings view show provider, capability, enabled state, last
success/failure, success rate, latency, spend, and result totals. They never
return credentials or raw provider payloads, and the endpoint returns 404 in
production.

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

Provider results are not automatically evidence. When an authenticated
project-company workflow chooses to preserve a public result, the evidence
ingestion boundary records the provider label, source URL, observation time,
raw source content, normalized content hash, and source-grounded claim.
Operational `provider_usage` remains separate from evidence review and from all
commercial interpretation.

## Deterministic mock adapters

This milestone includes mock adapters for `WEB_SEARCH`, `WEBSITE_CRAWL`, and
`JOB_SEARCH`. Their outputs use `mock://` references and explicitly label
themselves as deterministic mock output, not external evidence. Tests can
configure success, empty, retryable failure, or terminal failure without
network access.

The Apify adapter is available for production research, but no paid Actor or
specific Actor capability is enabled by default.

## Safety rules

Research Planner uses this router as its only provider boundary. Each execution requests exactly the capability recorded on the selected question. Provider failures, unavailable capabilities, empty results, and usage remain explicit job outcomes; the planner does not fabricate fallback content or invoke every provider.

- Never fabricate a provider response.
- Never treat a provider timeout as a negative finding.
- Do not enrich people before company qualification.
- Do not expose one customer’s private interpretation to another customer.
- Keep credentials in Replit Secrets or a managed integration, never in source control.