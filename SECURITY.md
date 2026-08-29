# DigiSignal Security

## Trust boundaries

DigiSignal separates:

- user identity and tenant authorization
- public source evidence
- customer-specific configuration
- customer-specific interpretation
- provider credentials and usage

Every protected request derives user identity from the authenticated Clerk session. Organization and project IDs may select a resource, but membership is resolved server-side before any tenant data is returned.

## Authorization

Authorization is deterministic and server-side. The client may hide unavailable actions for usability, but the API remains the source of truth.

Implemented tenant routes return `401` without a valid session, `404` when a requested resource does not exist, and `403` when the user is authenticated but lacks membership. Unauthorized project responses contain no project or organization data.

The browser uses Clerk's secure session cookie. DigiSignal does not store Clerk tokens in local storage or add browser bearer-token plumbing. Local storage contains only the selected organization and project IDs, which are untrusted navigation preferences.

Future roles should use least privilege for configuration, research, evidence, interpretation, billing, and administration.

## Evidence integrity

Original evidence is retained with capture metadata and provider provenance. Generated text cannot replace or overwrite source evidence.

## Secrets and providers

Credentials are stored using Replit Secrets or managed integrations. Logs redact authorization headers, cookies, and sensitive provider payloads. Provider usage and cost are tenant-scoped.

## AI boundaries

AI output is treated as assistive and reviewable. It cannot authorize access, merge canonical entities, calculate protected scores, decide billing, or create provenance.

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