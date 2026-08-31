# JYRA Real Data Test 14A — Managed SOC WHEN / WHY

## Final status

**PASS**

This development-only run evaluated exactly the five Test 13 `LIKELY_FIT` companies. It used only the existing approved and active Managed SOC signal pack and the existing WEB_SEARCH provider path. It did not perform discovery, contact enrichment, WHO changes, direct LinkedIn scraping, Apify technology research, or production operations.

## Root-cause analysis

The executor inspected the latest question for the company, regardless of question type. Once the first independent Managed SOC question became ANSWERED with a future nextRefreshAt, the shared company-level refresh guard returned early for the remaining question types before job creation, budget reservation, or provider routing. Explicit planned questions also did not reuse an existing matching terminal question row, which could collide with the database uniqueness constraint on refresh.

The fix preserves the ordinary refresh gate, but planned independent signal-pack questions no longer inherit another question's refresh date. Each planned question now receives its own terminal disposition.

## Summary

- Companies: 5
- Questions executed: 20
- Questions investigated: 20
- Questions answered from cache: 0
- Questions deferred: 0
- Provider attempts: 21
- Estimated cost: $0.2100
- Actual cost: $0.0000
- New evidence: 0
- Pending fact proposals: 4
- Approved observed facts: 0
- Active signals: 0
- Active clusters: 0
- WHY provenance: PASS
- Unsupported intent claims: 0
- Wrong-entity evidence: 0
- Duplicate-event inflation: 0
- Production operations: 0

## Ranking

1. **Cloud4C Services** — WATCH; score UNKNOWN; confidence UNKNOWN; Insufficient evidence for a scored Managed SOC opportunity
2. **Cloudi** — WATCH; score UNKNOWN; confidence UNKNOWN; Insufficient evidence for a scored Managed SOC opportunity
3. **E2E Cloud** — WATCH; score UNKNOWN; confidence UNKNOWN; Insufficient evidence for a scored Managed SOC opportunity
4. **ENTUNE IT Consulting Pvt Ltd** — WATCH; score UNKNOWN; confidence UNKNOWN; Insufficient evidence for a scored Managed SOC opportunity
5. **Emergys** — WATCH; score UNKNOWN; confidence UNKNOWN; Insufficient evidence for a scored Managed SOC opportunity

## Per-company result

| Company | Questions | Calls | Accepted evidence | Rejected/ambiguous | Approved facts | Signals | Clusters | State | Score | Confidence | WHEN |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Cloud4C Services | 4 | 5 | 11 | 0 | 0 | 0 | 0 | WATCH | UNKNOWN | UNKNOWN | UNKNOWN — no accepted current timing signal |
| Cloudi | 4 | 4 | 3 | 0 | 0 | 0 | 0 | WATCH | UNKNOWN | UNKNOWN | UNKNOWN — no accepted current timing signal |
| E2E Cloud | 4 | 4 | 13 | 0 | 0 | 0 | 0 | WATCH | UNKNOWN | UNKNOWN | UNKNOWN — no accepted current timing signal |
| ENTUNE IT Consulting Pvt Ltd | 4 | 4 | 3 | 0 | 0 | 0 | 0 | WATCH | UNKNOWN | UNKNOWN | UNKNOWN — no accepted current timing signal |
| Emergys | 4 | 4 | 14 | 0 | 0 | 0 | 0 | WATCH | UNKNOWN | UNKNOWN | UNKNOWN — no accepted current timing signal |

### Cloud4C Services

- Domain: cloud4c.com
- Pre-existing state: {"researchJobs":7,"evidence":21,"facts":0,"signals":0,"clusters":0,"opportunities":1,"capturedAt":"2026-08-31T10:40:17.360Z"}
- WHEN: UNKNOWN — no accepted current timing signal
- WHY: Insufficient evidence to establish current urgency.
- Opportunity hypothesis: Insufficient evidence for a scored Managed SOC opportunity
- Missing evidence: Security leader change; Security operations hiring; Funded risk program window; Security stack change
- Contradictions: NONE
- Next-best action: Gather independent, direct evidence for the missing approved Managed SOC signal areas; do not infer intent.
- Questions:
  - LEADERSHIP: "Cloud4C Services" cloud4c.com public evidence of security leadership changes (security, ciso) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 11; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - HIRING: "Cloud4C Services" cloud4c.com public evidence of security and cybersecurity hiring (security, soc, cyber) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 11; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - EXPANSION: "Cloud4C Services" cloud4c.com public evidence of funding, expansion, security, or compliance initiatives — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 11; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - TECHNOLOGY: "Cloud4C Services" cloud4c.com public evidence of security stack, SOC, SIEM, EDR, or IAM changes (security, siem, endpoint, iam) — INSUFFICIENT_EVIDENCE; calls 2; cache hits 0; raw 0; relevant 2; direct 2; context 0; rejected 9; cost $0.02; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
- Provider attempts:
  - Tavily / WEB_SEARCH: success; $0.01; 1508 ms
  - Tavily / WEB_SEARCH: success; $0.01; 3014 ms
  - Tavily / WEB_SEARCH: success; $0.01; 7310 ms
  - Tavily / WEB_SEARCH: success; $0.01; 3248 ms
  - Tavily / WEB_SEARCH: success; $0.01; 1329 ms
- Entity-matched raw evidence (not fact-accepted or signal-supporting by default):
  - https://cloud4c.com/cybersecurity-services/hybrid-multi-cloud-security — RAW
  - https://cloud4c.com/blogs/managed-security-for-multi-cloud-environments — RAW
  - https://leadiq.com/c/cloud4c-services/5a1d9a712300005400898c40 — RAW
  - https://cloud4c.com/blogs/day-in-the-life-of-a-soc-analyst — RAW
  - https://cloud4c.com/data-privacy — RAW
  - https://cloud4c.com/esg-initiatives — RAW
  - https://cloud4c.com/cybersecurity-services/compliance-as-a-service — RAW
  - https://cloud4c.com/global-isv-partnership-program — RAW
  - https://cloud4c.com/cybersecurity-services/endpoint-security — RAW
  - https://cloud4c.com/blogs/managed-security-model-for-the-next-decade — RAW
  - https://cloud4c.com/blogs/cloud-security-solutions-blog — RAW
- Rejected or ambiguous evidence:
  - NONE
- Facts:
  - PENDING: TECHNOLOGY_MENTION — Embrace cutting-edge public-private-hybrid cloud solutions powered by AWS, Azure, Google Cloud Platform (GCP), Oracle, or IBM Cloud architecture.
  - PENDING: TECHNOLOGY_MENTION — They are operations built on AI-driven SIEM, advanced cross-cloud threat correlation, and dedicated security analysts working across provider environments without siloed tooling.
  - PENDING: TECHNOLOGY_MENTION — Cloud4C, as a global managed services provider, partners with the world’s top technology companies and hyperscaler cloud providers such as AWS, Azure, GCP, OCI who are torchbearers of the sustainable IT revolution.
- Signals:
  - NONE
- Clusters:
  - NONE

### Cloudi

- Domain: cloudi-infra.com
- Pre-existing state: {"researchJobs":5,"evidence":11,"facts":0,"signals":0,"clusters":0,"opportunities":1,"capturedAt":"2026-08-31T10:40:17.360Z"}
- WHEN: UNKNOWN — no accepted current timing signal
- WHY: Insufficient evidence to establish current urgency.
- Opportunity hypothesis: Insufficient evidence for a scored Managed SOC opportunity
- Missing evidence: Security leader change; Security operations hiring; Funded risk program window; Security stack change
- Contradictions: NONE
- Next-best action: Gather independent, direct evidence for the missing approved Managed SOC signal areas; do not infer intent.
- Questions:
  - LEADERSHIP: "Cloudi" cloudi-infra.com public evidence of security leadership changes (security, ciso) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 3; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - HIRING: "Cloudi" cloudi-infra.com public evidence of security and cybersecurity hiring (security, soc, cyber) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 3; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - EXPANSION: "Cloudi" cloudi-infra.com public evidence of funding, expansion, security, or compliance initiatives — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 3; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - TECHNOLOGY: "Cloudi" cloudi-infra.com public evidence of security stack, SOC, SIEM, EDR, or IAM changes (security, siem, endpoint, iam) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 3; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
- Provider attempts:
  - Tavily / WEB_SEARCH: success; $0.01; 5085 ms
  - Tavily / WEB_SEARCH: success; $0.01; 7082 ms
  - Tavily / WEB_SEARCH: success; $0.01; 2667 ms
  - Tavily / WEB_SEARCH: success; $0.01; 4505 ms
- Entity-matched raw evidence (not fact-accepted or signal-supporting by default):
  - https://cloudi-infra.com/about — RAW
  - https://linkedin.com/company/cloudi-infra — RAW
  - https://cloudi-infra.com/cyber-security — RAW
- Rejected or ambiguous evidence:
  - NONE
- Facts:
  - NONE
- Signals:
  - NONE
- Clusters:
  - NONE

### E2E Cloud

- Domain: e2enetworks.com
- Pre-existing state: {"researchJobs":5,"evidence":16,"facts":0,"signals":0,"clusters":0,"opportunities":1,"capturedAt":"2026-08-31T10:40:17.360Z"}
- WHEN: UNKNOWN — no accepted current timing signal
- WHY: Insufficient evidence to establish current urgency.
- Opportunity hypothesis: Insufficient evidence for a scored Managed SOC opportunity
- Missing evidence: Security leader change; Security operations hiring; Funded risk program window; Security stack change
- Contradictions: NONE
- Next-best action: Gather independent, direct evidence for the missing approved Managed SOC signal areas; do not infer intent.
- Questions:
  - LEADERSHIP: "E2E Cloud" e2enetworks.com public evidence of security leadership changes (security, ciso) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 13; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - HIRING: "E2E Cloud" e2enetworks.com public evidence of security and cybersecurity hiring (security, soc, cyber) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 13; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - EXPANSION: "E2E Cloud" e2enetworks.com public evidence of funding, expansion, security, or compliance initiatives — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 13; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - TECHNOLOGY: "E2E Cloud" e2enetworks.com public evidence of security stack, SOC, SIEM, EDR, or IAM changes (security, siem, endpoint, iam) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 13; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
- Provider attempts:
  - Tavily / WEB_SEARCH: success; $0.01; 6855 ms
  - Tavily / WEB_SEARCH: success; $0.01; 6085 ms
  - Tavily / WEB_SEARCH: success; $0.01; 229 ms
  - Tavily / WEB_SEARCH: success; $0.01; 3523 ms
- Entity-matched raw evidence (not fact-accepted or signal-supporting by default):
  - https://e2enetworks.com/careers/jobs/all — RAW
  - https://e2enetworks.com/careers/jobs/security-operations-analyst — RAW
  - https://docs.e2enetworks.com/docs/myaccount/security — RAW
  - https://e2enetworks.com/certifications — RAW
  - https://e2e-mainsite-ui.objectstore.e2enetworks.net/Investor_Resources/Investor_Presentations/Investors_Presentation_September_2023_27_09_2023.pdf — RAW
  - https://nsearchives.nseindia.com/corporate/E2E_22072025164315_InvestorsPresentationFinal.pdf — RAW
  - https://e2enetworks.com/investors/corporate-announcements — RAW
  - https://e2enetworks.com/e2e-partner-program — RAW
  - https://e2enetworks.com/sovereign-cloud-platform — RAW
  - https://e2enetworks.com/investors/shareholders-meeting — RAW
  - https://e2enetworks.com/blog — RAW
  - https://docs.e2enetworks.com/docs/myaccount/GettingStarted/iam — RAW
  - https://marketplace.e2enetworks.com/vendors/guidelines — RAW
- Rejected or ambiguous evidence:
  - NONE
- Facts:
  - NONE
- Signals:
  - NONE
- Clusters:
  - NONE

### ENTUNE IT Consulting Pvt Ltd

- Domain: entune.co
- Pre-existing state: {"researchJobs":5,"evidence":7,"facts":0,"signals":0,"clusters":0,"opportunities":1,"capturedAt":"2026-08-31T10:40:17.360Z"}
- WHEN: UNKNOWN — no accepted current timing signal
- WHY: Insufficient evidence to establish current urgency.
- Opportunity hypothesis: Insufficient evidence for a scored Managed SOC opportunity
- Missing evidence: Security leader change; Security operations hiring; Funded risk program window; Security stack change
- Contradictions: NONE
- Next-best action: Gather independent, direct evidence for the missing approved Managed SOC signal areas; do not infer intent.
- Questions:
  - LEADERSHIP: "ENTUNE IT Consulting Pvt Ltd" entune.co public evidence of security leadership changes (security, ciso) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 3; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - HIRING: "ENTUNE IT Consulting Pvt Ltd" entune.co public evidence of security and cybersecurity hiring (security, soc, cyber) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 3; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - EXPANSION: "ENTUNE IT Consulting Pvt Ltd" entune.co public evidence of funding, expansion, security, or compliance initiatives — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 3; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - TECHNOLOGY: "ENTUNE IT Consulting Pvt Ltd" entune.co public evidence of security stack, SOC, SIEM, EDR, or IAM changes (security, siem, endpoint, iam) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 3; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
- Provider attempts:
  - Tavily / WEB_SEARCH: success; $0.01; 1475 ms
  - Tavily / WEB_SEARCH: success; $0.01; 3233 ms
  - Tavily / WEB_SEARCH: success; $0.01; 7137 ms
  - Tavily / WEB_SEARCH: success; $0.01; 7520 ms
- Entity-matched raw evidence (not fact-accepted or signal-supporting by default):
  - https://entune.co/industry-solutions — RAW
  - https://entune.co/5-reasons-why-you-should-join-entune-it-consulting-pvt-ltd — RAW
  - https://entune.co/contact-us — RAW
- Rejected or ambiguous evidence:
  - NONE
- Facts:
  - NONE
- Signals:
  - NONE
- Clusters:
  - NONE

### Emergys

- Domain: emergys.com
- Pre-existing state: {"researchJobs":5,"evidence":17,"facts":0,"signals":0,"clusters":0,"opportunities":1,"capturedAt":"2026-08-31T10:40:17.360Z"}
- WHEN: UNKNOWN — no accepted current timing signal
- WHY: Insufficient evidence to establish current urgency.
- Opportunity hypothesis: Insufficient evidence for a scored Managed SOC opportunity
- Missing evidence: Security leader change; Security operations hiring; Funded risk program window; Security stack change
- Contradictions: NONE
- Next-best action: Gather independent, direct evidence for the missing approved Managed SOC signal areas; do not infer intent.
- Questions:
  - LEADERSHIP: "Emergys" emergys.com public evidence of security leadership changes (security, ciso) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 14; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - HIRING: "Emergys" emergys.com public evidence of security and cybersecurity hiring (security, soc, cyber) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 14; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - EXPANSION: "Emergys" emergys.com public evidence of funding, expansion, security, or compliance initiatives — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 14; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
  - TECHNOLOGY: "Emergys" emergys.com public evidence of security stack, SOC, SIEM, EDR, or IAM changes (security, siem, endpoint, iam) — INSUFFICIENT_EVIDENCE; calls 1; cache hits 0; raw 0; relevant 0; direct 0; context 0; rejected 14; cost $0.01; stop: Reasonable bounded attempt found no accepted signal-supporting fact.
- Provider attempts:
  - Tavily / WEB_SEARCH: success; $0.01; 1265 ms
  - Tavily / WEB_SEARCH: success; $0.01; 7110 ms
  - Tavily / WEB_SEARCH: success; $0.01; 2920 ms
  - Tavily / WEB_SEARCH: success; $0.01; 3769 ms
- Entity-matched raw evidence (not fact-accepted or signal-supporting by default):
  - https://emergys.com/careers/senior-windows-server-administrator — RAW
  - https://emergys.com/careers/solutions-architect-engineer — RAW
  - https://emergys.com/industries/banking-financial-services-and-insurance — RAW
  - https://leadiq.com/c/emergys/5a1d800324000024005afeb2 — RAW
  - https://emergys.com/whitepapers — RAW
  - https://emergys.com/news/vyomlabs-now-rebranded-as-emergys — RAW
  - https://emergys.com/news — RAW
  - https://emergys.com/blog/business-intelligence-bi-for-regulatory-compliance — RAW
  - https://emergys.com/modern-applications/platform-engineering/platform-sustenance — RAW
  - https://emergys.com/news/bmc-connect-2024 — RAW
  - https://emergys.com/news/emergys-sme-tech-advancements-with-sap — RAW
  - https://emergys.com/blog/digital-transformation-for-financial-services-with-servicenow — RAW
  - https://emergys.com/blog/top-no-code-and-low-code-platforms-for-2023 — RAW
  - https://emergys.com/blog/how-a-cross-platform-ai-assistant-unifies-the-modern-enterprise — RAW
- Rejected or ambiguous evidence:
  - NONE
- Facts:
  - PENDING: TECHNOLOGY_MENTION — Emergys uses 8 technology products and services including Continuous Delivery, GitLab CI, SQL, and more. Explore Emergys's tech stack below.

* Continuous Delivery

  Continuous Integration
* GitLab CI

  Continuous Integration
* SQL

  Database
* Oracle

  Enterprise
* JSON-LD

  Javascript Frameworks
* Really Simple Discovery

  Miscellaneous
* Google Tag Manager

  Tag Management
* Autoptimize

  Web Platform Extensions
- Signals:
  - NONE
- Clusters:
  - NONE


## Test 14 versus Test 14A

- Test 14: 20 questions; 4 provider attempts; 0 approved facts; 0 signals.
- Test 14A: 20 questions; 21 provider attempts; 8 question-relevant results; 2 direct-event results; 0 approved facts; 0 signals.
- Coverage materially improved: YES.

## Safety and quality assertions

```json
{
  "quality": {
    "whyProvenance": "PASS",
    "unsupportedIntentClaims": 0,
    "wrongEntityEvidence": 0,
    "duplicateEventInflation": 0,
    "missingEvidenceTreatedAsNegative": "PASS",
    "costQuestionTraceability": "PASS",
    "terminalQuestionCoverage": "PASS",
    "unexplainedGenericDeferred": 0,
    "skippedCompanies": 0,
    "sellerContentProducedBuyerSignal": "PASS",
    "genericContentEstablishedWhen": "PASS"
  },
  "safety": {
    "delta": {
      "questions": 0,
      "jobs": 0,
      "evidence": 0,
      "facts": 0,
      "proposals": 0,
      "costs": 0,
      "signals": 0,
      "clusters": 0,
      "opportunities": 0,
      "contacts": 0
    },
    "providerCallsWithinBound": true,
    "estimatedCostWithinBound": true,
    "perCompanyEstimatedCostWithinBound": true,
    "contactEnrichmentDelta": 0,
    "productionOperations": 0
  }
}
```
