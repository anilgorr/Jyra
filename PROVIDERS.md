# JYRA Providers

## Provider router goals

The provider router will:

1. Ask the cheapest viable source first.
2. Reuse public intelligence where permitted.
3. Spend more only when more information could change a company decision.
4. Record request status, latency, cost, and result provenance.
5. Apply deterministic retry, timeout, budget, and stopping rules.

## Provider categories

Future provider adapters may cover:

- company and website discovery
- public web and news research
- hiring and job-posting evidence
- funding and corporate events
- technology and infrastructure signals
- business directories
- contact enrichment

Specific providers must be selected only after their terms, fields, rate limits, and data provenance are understood.

## Adapter contract

Each adapter should accept a typed research question and return:

- provider request ID
- normalized status
- raw response reference
- source evidence candidates
- usage and cost metadata
- retryability
- captured timestamp

Adapters must not directly write commercial interpretations.

## Safety rules

- Never fabricate a provider response.
- Never treat a provider timeout as a negative finding.
- Do not enrich people before company qualification.
- Do not expose one customer’s private interpretation to another customer.
- Keep credentials in Replit Secrets or a managed integration, never in source control.