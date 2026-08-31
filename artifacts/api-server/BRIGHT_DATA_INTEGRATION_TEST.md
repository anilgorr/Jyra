# Bright Data Integration Test

Provider: Bright Data
Capability: COMPANY_FIRMOGRAPHICS
Credentials: AVAILABLE
Health: FAILING
Dataset attempted: gd_l1vikfnt1wgvvqz95d
Required dataset now configured: gd_l1vikfnt1wgvvqz95w
Real API calls: 2
Companies tested: 1
Records returned: 0
Entity match: UNKNOWN
Industry returned: NO
Employee data returned: NO
Geography returned: NO
Website returned: NO
Canonical domain safely resolved: YES
Attribute provenance: FAIL
Cost tracking: PASS
API key exposed: NO
Exa calls: 0
Tavily calls: 0
Apify calls: 0
Contact enrichment: 0
Signals created: 0
Opportunity records created: 0
Production operations: 0

## Controlled Test Detail

Company: Emergys
Input LinkedIn URL: https://www.linkedin.com/company/emergys-llc/
HTTP status: failed
Bright Data records: 0
Returned company name: UNKNOWN
Returned LinkedIn URL: UNKNOWN
Website: UNKNOWN
Canonical domain: UNKNOWN
Industry: UNKNOWN
Employee count: UNKNOWN
Employee range: UNKNOWN
HQ city: UNKNOWN
HQ region/state: UNKNOWN
HQ country: UNKNOWN
Founded year: UNKNOWN
Description available: NO
Other useful fields: NONE
Latency: 662 ms
Estimated cost: $0.0015 (ESTIMATED)
Canonical company updated: NO
Why: This explicitly triggered health/data-quality test is report-only.

FINAL STATUS: FAIL

Provider error: NO_RESULT — Bright Data request failed

## Validation drift

Both authorized live requests used the pre-review dataset ID ending in `95d`.
The configured adapter now uses the required LinkedIn Company Information dataset
ending in `95w`, but no additional external request was made after correction.
Therefore this report intentionally remains `FAIL`; it does not claim the required
dataset returned a successful record.
