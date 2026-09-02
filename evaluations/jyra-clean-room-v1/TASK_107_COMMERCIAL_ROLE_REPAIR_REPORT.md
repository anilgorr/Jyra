# TASK #107 — Commercial Relationship Assessment Repair

**Status:** PASS

## Four-error audit and dominant pattern

### Lead Made Easy
- Benchmark company: 6594cacd-e2a9-4803-ba7a-e166b8da7489
- Domain: DIGIPUUSH
- Primary business: Lead Made Easy | 523 followers on LinkedIn. Pipeline-as-a-Service for SaaS &amp; IT Services firms. | Finding the right leads shouldn&#39;t be complicated. At Lead Made Easy, we help IT services and SaaS businesses connect with high-intent decision-makers through targeted outreach and appointment setting—so you can focus on closing deals, not chasing prospects.

WHY CHOOSE US?
- Products/services: Not available
- Seller: Digipuush
- Seller offering: AEO & GEO / AI Visibility Services
- Task 106: ADJACENT_VENDOR / MEDIUM; The candidate (Lead Made Easy) is a pipeline/lead-generation and appointment-setting service for SaaS and IT services firms, which complements DigiPuush's AEO/GEO/AI visibility and SEO services that drive discoverability and attribution. There is no evidence that Lead Made Easy offers competing AI/SEO visibility products or that it is an existing partner or buyer of DigiPuush, so the safest seller-relative classification is ADJACENT_VENDOR.
- Evidence IDs: 6594cacd-e2a9-4803-ba7a-e166b8da7489
- Gold: POTENTIAL_BUYER
- Failure pattern: Shared workflow/customer vocabulary outweighed candidate buyer capability despite no substitute offering.

### OutPro
- Benchmark company: ada76ca1-a14b-48e4-8de6-e96498b23d95
- Domain: DIGIPUUSH
- Primary business: OutPro | 1,190 followers on LinkedIn. People, Process, Playbook - No Leads Left Behind
 | Most B2B SaaS companies don&#39;t have a GTM problem. They have a systems problem.

The pipeline is inconsistent.
- Products/services: Not available
- Seller: Digipuush
- Seller offering: AEO & GEO / AI Visibility Services
- Task 106: UNKNOWN / LOW; LLM_LOW_CONFIDENCE
- Evidence IDs: none on accepted assessment
- Gold: POTENTIAL_BUYER
- Failure pattern: Candidate-as-consumer was identified but confidence calibration left the seller-relative role unresolved.

### Partner Propel
- Benchmark company: 252b9ea5-ec55-49b5-8bf7-c514da6ca2cd
- Domain: DIGIPUUSH
- Primary business: Partner Propel | 500 followers on LinkedIn. We set up AI GTM systems for SMBs. | Most B2B SaaS companies plateau around $5M because growth depends on inconsistent referrals and founder-led sales.

You know you need systematic outbound. But hiring SDRs costs $80K+ per person per year.
- Products/services: Not available
- Seller: Digipuush
- Seller offering: AEO & GEO / AI Visibility Services
- Task 106: PARTNER_POSSIBLE / MEDIUM; Public company description states Partner Propel 'set up AI GTM systems for SMBs' and focuses on GTM/outbound for B2B SaaS. That makes them plausibly complementary to Digipuush's AI visibility/SEO services (opportunity for referral, integration, or co-delivery), with no evidence they offer substantially overlapping AEO/GEO SEO services.
- Evidence IDs: 252b9ea5-ec55-49b5-8bf7-c514da6ca2cd
- Gold: POTENTIAL_BUYER
- Failure pattern: Partnership inferred without affirmative channel, referral, reseller, integration, or co-delivery evidence.

### RevyGo
- Benchmark company: 4233dfdf-a2ac-48de-8347-91759eb415de
- Domain: DIGIPUUSH
- Primary business: null
- Products/services: Not available
- Seller: Digipuush
- Seller offering: AEO & GEO / AI Visibility Services
- Task 106: UNKNOWN / LOW; LLM_LOW_CONFIDENCE
- Evidence IDs: none on accepted assessment
- Gold: POTENTIAL_BUYER
- Failure pattern: Candidate-as-consumer was identified but confidence calibration left the seller-relative role unresolved.

Dominant pattern: Shared ICP, service, and workflow vocabulary was overweighted while candidate-as-consumer capability and affirmative partnership evidence were underweighted.

## Implementation

- Before: fix08-company-understanding-v4 / implicit commercial-role ordering
- After: fix08-company-understanding-v5 / commercial-relationship-v2
- Model unchanged: gpt-5-mini
- Versioned prompt-only Commercial Relationship repair: material substitutability first, affirmative vendor/partner evidence, then candidate buyer capability.

## Tests

- Generic synthetic checks: PASS 12/12
- Existing regressions: PASS 11/11 suites

## Task #106 → Task #107

- CommercialRole coverage: 20/20 → 20/20
- Non-UNKNOWN CommercialRole: 16/20 → 16/20
- WHO available: 14/20 → 16/20
- Complete CommercialRole + WHO: 14/20 → 16/20
- CommercialRole strict accuracy: 13/18 → 15/18
- WHO strict accuracy: 11/18 → 13/18
- POTENTIAL_BUYER precision: 100% → 100%
- SELLER_COMPETITOR recall: 100% → 100%
- Dangerous competitor → buyer: 0 → 0
- CommercialRole first-errors: 4 → 2

## Four prior CommercialRole errors

- Lead Made Easy: ADJACENT_VENDOR → POTENTIAL_BUYER; gold POTENTIAL_BUYER; correct now YES
- OutPro: UNKNOWN → UNKNOWN; gold POTENTIAL_BUYER; correct now NO
- Partner Propel: PARTNER_POSSIBLE → POTENTIAL_BUYER; gold POTENTIAL_BUYER; correct now YES
- RevyGo: UNKNOWN → UNKNOWN; gold POTENTIAL_BUYER; correct now NO

## New regressions

- Previously-correct records now wrong: 0
- Companies: NONE

## First-error distribution

- IDENTITY_RESOLUTION: 1
- COMPANY_UNDERSTANDING: 0
- COMMERCIAL_ROLE: 2
- ICP_CRITERION_MAPPING: 0
- WHO_DECISION_POLICY: 0
- INSUFFICIENT_EVIDENCE_HANDLING: 0
- PROVIDER_DATA_GAP: 2
- OTHER: 0

## Remaining errors

- b45eeee7-aab7-412f-b7e7-4c95c999fa14: PROVIDER_DATA_GAP
- b7e9af09-ede7-46fb-baa1-cf2d9f3158bf: PROVIDER_DATA_GAP
- ada76ca1-a14b-48e4-8de6-e96498b23d95: COMMERCIAL_ROLE
- 4233dfdf-a2ac-48de-8347-91759eb415de: COMMERCIAL_ROLE
- 50ceadee-afc9-41a1-b7c7-f6334e213df8: IDENTITY_RESOLUTION

## Safety

- Provider calls: 0
- Gold modified: NO
- Historical runs modified: NO
- Production modified: NO
- Benchmark-specific runtime logic: NO
- Evidence provenance preserved: YES
- Task #105 behavior preserved: YES
- Task #106 WHO policy preserved: YES

**Verdict:** YES
