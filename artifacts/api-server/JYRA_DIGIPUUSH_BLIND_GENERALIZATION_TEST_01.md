# DIGIPUUSH BLIND GENERALIZATION TEST 01

## CONFIGURATION

- Seller = Digipuush
- Offering = AEO & GEO / AI Visibility Services
- Business Twin Version = 1 (`48d80510-1f54-41b2-bdcd-2e82a0eb9913`)
- ICP Version = 7 (`e7b9a805-f690-449f-8958-e35cd301e366`)
- ICP Status = EARLY_EVIDENCE_ICP; usable
- Opportunity Pack = not required; none exists
- CompanyUnderstanding Version = fix08-company-understanding-v4
- CommercialRole Version = buyer-role-resolution-06a
- Model = gpt-5-mini
- Normalization Version = fix07-v1
- Discovery Version = buildDiscoveryPlan-derived; no explicit production version constant
- Discovery Strategy SHA-256 = `d04ed4215fc5098fd3a350ea4b2791c94502c53e98dcccc1a6f8ce223ad2b3cc`
- Genericity check = DigiPuush-specific production logic = 0

---

## DISCOVERY

- Requested = 20
- Raw candidates = 20
- Canonical candidates = 20 linked canonical entities (0 newly created)
- Final cohort = 20
- Plausible market = 20
- Wrong market = 0
- Unclear = 0
- Plausible market rate = 100.0%

---

## INTELLIGENCE

- Identity correct = 19
- Identity wrong = 0
- Identity uncertain = 1
- JYRA profile sufficient = 1/20
- Independent public profile sufficient = 19/20

### JYRA roles

- POTENTIAL_BUYER = 1
- SELLER_COMPETITOR = 0
- ADJACENT_VENDOR = 0
- PARTNER_POSSIBLE = 0
- UNKNOWN = 19

### Independent roles

- POTENTIAL_BUYER = 9
- SELLER_COMPETITOR = 0
- ADJACENT_VENDOR = 5
- PARTNER_POSSIBLE = 5
- UNKNOWN = 1

---

## QUALITY

- Identity precision = 95.0%
- Profile sufficiency rate = 5.0%
- Company-understanding accuracy = 10.0%
- Commercial-role exact agreement = 5.0%
- Potential-buyer precision = 0.0%
- Potential-buyer recall = 0.0%
- Seller/competitor → buyer errors = 0
- WHO agreement = 5.0%
- UNKNOWN rate = 95.0%

### Acceptance targets

- identityPrecision = PASS
- plausibleMarketCandidateRate = PASS
- companyUnderstandingAccuracy = FAIL
- commercialRoleExactAgreement = FAIL
- potentialBuyerPrecision = FAIL
- sellerCompetitorToBuyerZero = PASS
- whoAgreement = FAIL

---

## COMMERCIAL ROLE CONFUSION MATRIX

Rows are JYRA roles; columns are independently adjudicated roles.

| JYRA \ Independent | POTENTIAL_BUYER | SELLER_COMPETITOR | ADJACENT_VENDOR | PARTNER_POSSIBLE | UNKNOWN |
|---|---:|---:|---:|---:|---:|
| POTENTIAL_BUYER | 0 | 0 | 0 | 1 | 0 |
| SELLER_COMPETITOR | 0 | 0 | 0 | 0 | 0 |
| ADJACENT_VENDOR | 0 | 0 | 0 | 0 | 0 |
| PARTNER_POSSIBLE | 0 | 0 | 0 | 0 | 0 |
| UNKNOWN | 9 | 0 | 5 | 4 | 1 |

---

## ERROR ATTRIBUTION

- DISCOVERY_WRONG_MARKET = 0
- IDENTITY_WRONG = 0
- PROFILE_EVIDENCE_INSUFFICIENT = 18
- COMPANY_UNDERSTANDING_WRONG = 0
- BUSINESS_MODEL_WRONG = 0
- INDUSTRY_WRONG = 0
- COMMERCIAL_RELATIONSHIP_REASONING_WRONG = 1
- ICP_QUALIFICATION_WRONG = 0
- LOW_CONFIDENCE_SHOULD_HAVE_BEEN_UNKNOWN = 0
- OTHER = 0


The 18 profile-evidence errors are primary-cause assignments: they also explain the downstream CompanyUnderstanding, role, and WHO misses. Corefactors had usable understanding evidence but the independent role differed, so its primary cause is commercial-relationship reasoning.

---

## COMPANY RESULTS

| Company | Identity | Market | JYRA role | Independent role | JYRA WHO | Independent WHO | Primary error |
|---|---|---|---|---|---|---|---|
| 3LOCKS | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | ADJACENT_VENDOR | INSUFFICIENT_DATA | POSSIBLE_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| Avataar | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | PARTNER_POSSIBLE | INSUFFICIENT_DATA | LIKELY_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| BetterPlace | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | POTENTIAL_BUYER | INSUFFICIENT_DATA | LIKELY_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| Bitla Software | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | POTENTIAL_BUYER | INSUFFICIENT_DATA | LIKELY_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| CData Virtuality | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | ADJACENT_VENDOR | INSUFFICIENT_DATA | POSSIBLE_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| Corefactors | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | POTENTIAL_BUYER | PARTNER_POSSIBLE | INSUFFICIENT_DATA | LIKELY_FIT | COMMERCIAL_RELATIONSHIP_REASONING_WRONG |
| Cyber Security Operations | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | ADJACENT_VENDOR | INSUFFICIENT_DATA | POSSIBLE_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| Decentro | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | POTENTIAL_BUYER | INSUFFICIENT_DATA | LIKELY_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| ekincare | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | POTENTIAL_BUYER | INSUFFICIENT_DATA | LIKELY_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| Jaza Software | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | POTENTIAL_BUYER | INSUFFICIENT_DATA | POSSIBLE_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| KDK Software | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | POTENTIAL_BUYER | INSUFFICIENT_DATA | LIKELY_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| KeyValue | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | PARTNER_POSSIBLE | INSUFFICIENT_DATA | POSSIBLE_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| Meander Software | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | ADJACENT_VENDOR | INSUFFICIENT_DATA | POSSIBLE_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| NeoDove | UNCERTAIN | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | UNKNOWN | INSUFFICIENT_DATA | INSUFFICIENT_DATA | — |
| Neysa | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | PARTNER_POSSIBLE | INSUFFICIENT_DATA | LIKELY_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| One2N | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | ADJACENT_VENDOR | INSUFFICIENT_DATA | POSSIBLE_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| PagarBook | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | POTENTIAL_BUYER | INSUFFICIENT_DATA | LIKELY_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| Pramati | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | PARTNER_POSSIBLE | INSUFFICIENT_DATA | LIKELY_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| RazorSign | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | POTENTIAL_BUYER | INSUFFICIENT_DATA | LIKELY_FIT | PROFILE_EVIDENCE_INSUFFICIENT |
| Setu | CORRECT | PLAUSIBLE_MARKET_CANDIDATE | UNKNOWN | POTENTIAL_BUYER | INSUFFICIENT_DATA | LIKELY_FIT | PROFILE_EVIDENCE_INSUFFICIENT |

---

## COST

- Discovery calls = 2
- Profile calls = 0
- Firmographic calls = 0
- LLM calls = 1
- Cache hits = 3 discovery public-cache candidates; 0 semantic
- Input tokens = 1399
- Output tokens = 1193
- Total tokens = 2592
- Discovery cost = $0.014
- Profile cost = $0.000
- Firmographic cost = $0.000
- LLM cost = UNKNOWN (billing amount unavailable)
- Total known cost = $0.014
- Unknown cost = LLM billing amount unavailable; independent-adjudication infrastructure cost is also not in the JYRA cost ledger.

---

**PRODUCTION OPERATIONS = 0**

---

## VERDICT

**G — MULTIPLE MATERIAL FAILURES**

Market discovery and identity met their targets, but profile evidence/CompanyUnderstanding and WHO failed materially; commercial-role agreement and buyer precision/recall also failed. No repair or rerun was performed.
