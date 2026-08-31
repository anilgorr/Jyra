# Bright Data Integration Test

## Hotfix 01 — Offline Emergys Reprocessing

Provider API: PASS
Data quality: PASS
Entity matching: PASS
Previous Emergys status: PROBABLE
New Emergys status: CONFIRMED

## Identity reasons

+ Requested LinkedIn URL has trusted canonical or user-verified provenance
- Bright Data did not echo the LinkedIn URL
+ Returned company name matches the requested company
+ Returned official domain exactly agrees with canonical identity
+ No material contradictory identity evidence

Returned LinkedIn URL: ABSENT
Requested LinkedIn URL used as provenance: YES
Requested identifier provenance: USER_VERIFIED
Canonical domain verified: YES
Requested LinkedIn URL: https://www.linkedin.com/company/emergys-llc/
Normalized requested LinkedIn URL: https://linkedin.com/company/emergys-llc
Returned company name: Emergys
Returned website: https://emergys.com
Returned domain: emergys.com

## Eligible firmographic attributes

- website/domain
- industry
- employee range
- LinkedIn employee count
- founded year
- description
- specialties
- followers

Unsupported attributes: 0
Attribute provenance: PASS
Stored provider result count: 1
Stored request latency: 5354 ms
Stored estimated cost: $0.0015 (ESTIMATED)
Canonical company updated: NO
New Bright Data calls: 0
Production operations: 0

FINAL STATUS: PASS
