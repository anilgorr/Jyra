# JYRA Security

## Trust boundaries

JYRA separates:

- user identity and tenant authorization
- public source evidence
- customer-specific configuration
- customer-specific interpretation
- provider credentials and usage

Every protected request derives user identity from the authenticated Clerk session. Organization and project IDs may select a resource, but membership is resolved server-side before any tenant data is returned.

## Authorization

Authorization is deterministic and server-side. The client may hide unavailable actions for usability, but the API remains the source of truth.

Implemented tenant routes return `401` without a valid session, `404` when a requested resource does not exist, and `403` when the user is authenticated but lacks membership. Unauthorized project responses contain no project or organization data.

The browser uses Clerk's secure session cookie. JYRA does not store Clerk tokens in local storage or add browser bearer-token plumbing. Local storage contains only the selected organization and project IDs, which are untrusted navigation preferences.

Future roles should use least privilege for configuration, research, evidence, interpretation, billing, and administration.

## Evidence integrity

Original evidence is retained with capture metadata and provider provenance.
Exact raw content is stored separately from its normalized SHA-256 hash and
source-grounded claim. The hash supports duplicate detection but never replaces
the original capture. Changed content creates another observation rather than
mutating history. PostgreSQL rejects updates and deletes to crawl captures, so
internal scripts and future routes cannot silently bypass API-level immutability.

Evidence reads and writes require an authenticated project-company route and a
server-side organization membership check. Public evidence may be reused for
the same canonical company across authorized projects, but evidence records
cannot contain tenant scores, opportunities, recommendations, or private
interpretation. The preserving organization owns review authority for its
observation; another organization linked to the same canonical company may read
the reusable public evidence but cannot alter its global status. Status
mutations use an allowlisted transition graph and update only status metadata.
Generated text cannot replace or overwrite source evidence.

## Secrets and providers

Credentials are stored using Replit Secrets or managed integrations. The Apify
adapter uses Replit's authenticated server-side `apify` proxy and never reads,
returns, or logs a token. Actor IDs are server-owned provider configuration,
never browser configuration. Logs redact authorization headers, cookies, and
sensitive provider payloads.

Provider diagnostics require an authenticated Clerk session, are disabled with
a 404 in production, and expose only non-secret operational aggregates. Actor
run and dataset IDs may be retained as operational correlation metadata, but
raw Actor payloads are not written to provider usage.

## AI boundaries

AI output is treated as assistive and reviewable. It cannot authorize access, merge canonical entities, calculate protected scores, decide billing, create provenance, rewrite raw captures, determine duplicate identity, or perform evidence status transitions.

## Application hygiene

- Validate request and response shapes with Zod.
- Use parameterized database queries.
- Resolve organization membership for every project read or write.
- Keep CORS and cookies appropriately scoped for production.
- Avoid logging raw research payloads unless explicitly redacted.
- Add rate limiting before enabling expensive provider-backed workflows.
- Keep dependency and secret scans part of the release process.

## Incident posture

Future releases must preserve audit records for access changes, provider requests, evidence changes, rule-version changes, and user-recorded outcomes. Destructive operations require explicit authorization and a recovery path.