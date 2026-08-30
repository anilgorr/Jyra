# JYRA REAL DATA TEST 06

## Final status: PASS

Executed on 2026-08-30 at 13:35 IST against the verified development database.

## Scope

- Company: 7C Studio
- Canonical domain: `7cstudio.com`
- Seller: Aadit Technologies
- Project: GTM-Q1
- Offering: Managed SOC
- Signal pack: `managed-soc v1.0`
- Fact extractor: `fact-extraction-v2`

The run used only the four evidence items accepted by Hotfix 05. It made no Tavily, Apify, company-discovery, contact-enrichment, or other research-provider calls.

## Trusted evidence used

| Evidence ID | Source | Classification | Accepted |
|---|---|---|---|
| `333dc2d6-12eb-4763-8636-1dc479f8e5be` | `https://in.linkedin.com/company/7evenc` | SOCIAL_COMPANY_PROFILE | Yes |
| `0f109dc7-149d-4970-b239-a2a47da3c3b0` | `https://crunchbase.com/organization/7c-studio` | BUSINESS_DATABASE | Yes |
| `df0f9b36-a64f-47bb-b9a0-33aad054dc3a` | `https://discover.7cstudio.com` | OFFICIAL_WEBSITE | Yes |
| `5cc130ef-a2e4-4e7a-97db-978293143014` | `https://7cstudio.com` | OFFICIAL_WEBSITE | Yes |

The older `http://7cstudio.com` payload and its facts were explicitly excluded because Test 06 permits only the four Hotfix 05-accepted items.

## Fact extraction and validation

### Approved candidate 1

- Type: `TECHNOLOGY_MENTION`
- Evidence: `5cc130ef-a2e4-4e7a-97db-978293143014`
- Effective date: `2026-08-30`
- Confidence: 100
- Value: React, Flutter, Swift, Kotlin
- Exact excerpt: “Melding React, Flutter, Swift, and Kotlin, we craft dynamic, user-centric interfaces.”
- Governance result: PENDING → APPROVED
- Fact ID: `07abb8d0-d4a8-4729-9807-3a6c32483511`

### Approved candidate 2

- Type: `TECHNOLOGY_MENTION`
- Evidence: `5cc130ef-a2e4-4e7a-97db-978293143014`
- Effective date: `2026-08-30`
- Confidence: 100
- Value: Python, AWS, GCP
- Exact excerpt: “With a backend built on Python, AWS, and GCP, we focus on speed and reliability.”
- Governance result: PENDING → APPROVED
- Fact ID: `7d158022-04e8-4680-8c5d-0908ff00206b`

### Rejected candidate 1

- Source: `https://in.linkedin.com/company/7evenc`
- Proposed type: `TECHNOLOGY_MENTION`
- Proposed value: blockchain, augmented reality, mobile applications, backend engineering
- Confidence: 99
- Excerpt: “We are focussed on blockchain, augmented reality, mobile applications and backend engineering.”
- Rejection reason: the excerpt describes specialties/capabilities, not a supported concrete technology-use fact.

### Rejected candidate 2

- Source: `https://discover.7cstudio.com`
- Proposed type: `TECHNOLOGY_MENTION`
- Proposed value: Ethereum, Bitcoin
- Confidence: 87
- Excerpt: “issued on public networks like Ethereum or Bitcoin with in-built compliance features.”
- Rejection reason: the excerpt is a generic product statement and does not establish that 7C Studio uses those technologies.

### No candidates

The accepted Crunchbase evidence produced no fact candidate. No unsupported claim was persisted.

## Managed SOC signal evaluation

| Signal definition | Result | Reason |
|---|---|---|
| `MSOC_SECURITY_LEADER` | Not triggered | No approved leadership-change fact concerning security or CISO leadership |
| `MSOC_SECURITY_HIRING` | Not triggered | No approved security/SOC/cyber hiring fact |
| `MSOC_FUNDED_RISK_PROGRAM` | Not triggered | No approved funding-event fact |
| `MSOC_SECURITY_STACK_CHANGE` | Not triggered | Approved technology facts list general application/cloud technologies, not security, SIEM, endpoint, or IAM stack changes |

Signals created: **0**

The engine did not convert general technical capabilities into security intent or Managed SOC need.

## Signal-cluster evaluation

- Active managed-SOC cluster definitions available for this project: 0
- Clusters evaluated: 0
- Clusters triggered: 0

No cluster was fabricated from absent signals.

## Opportunity result

| Dimension | Score | Status |
|---|---:|---|
| Fit | Unknown | UNKNOWN |
| Need | Unknown | UNKNOWN |
| Timing | Unknown | UNKNOWN |
| Relationship | Unknown | UNKNOWN |
| Confidence | Unknown | UNKNOWN |

- Overall score: Unknown
- State: `WATCH`
- Assessment status: `INSUFFICIENT_DATA`
- Unknown dimensions: Fit, Need, Timing, Relationship, Confidence

The opportunity engine did not turn missing dimensions into numeric zeroes and did not inflate the opportunity from technical facts alone.

## WHY and WHY NOW

WHY:

> Insufficient evidence to establish current urgency.

WHY status: `INSUFFICIENT_EVIDENCE`

WHY NOW:

> No evidence currently establishes Managed SOC need or buying timing.

There are no material WHY claims because no signal or cluster was triggered. Therefore no unsupported buying intent, budget, vendor search, urgency, or procurement claim was generated.

## Next best action

- Action: `RESEARCH_MORE`
- Label: Research more
- Rule version: `NBA_V1:OPPORTUNITY_MODEL_V1`
- Explanation: “The opportunity is not fully supported: Fit is unknown, Need is unknown, and Confidence is unknown.”

## Provenance

Approved fact 1:

`07abb8d0-d4a8-4729-9807-3a6c32483511`
→ evidence `5cc130ef-a2e4-4e7a-97db-978293143014`
→ `https://7cstudio.com`
→ no matching signal
→ no cluster
→ no material WHY claim

Approved fact 2:

`7d158022-04e8-4680-8c5d-0908ff00206b`
→ evidence `5cc130ef-a2e4-4e7a-97db-978293143014`
→ `https://7cstudio.com`
→ no matching signal
→ no cluster
→ no material WHY claim

## PASS checks

- PASS: Only the four Hotfix 05-accepted evidence items were read.
- PASS: Fact extraction ran with `fact-extraction-v2`.
- PASS: Two legitimate source-exact facts completed PENDING → APPROVED governance.
- PASS: Two unsupported candidates were rejected and not persisted.
- PASS: All four unchanged managed-SOC definitions were evaluated.
- PASS: No signal or cluster was fabricated.
- PASS: Opportunity uncertainty remained explicit.
- PASS: WHY remained conservative and contained no unsupported material claim.
- PASS: Next best action was deterministic and evidence-consistent.
- PASS: No external research, discovery, enrichment, or production operation occurred.