# JYRA Real Data Test 12 — Company Profile Resolution

## Final status

**PASS**

DECISION A: PROFILE RESOLUTION PASSES. Proceed to the chained Profile Resolution → Bright Data Firmographics evaluation in a separate test.

This development-only test used exactly the 10-company Real Data Test 11 population.
It stopped before Bright Data firmographic enrichment and created no contacts, signals,
facts, opportunity research, WHEN/WHY research, or production changes.

The exact Test 10 canonical identities and GTM-Q1 project links were required as
read-only preconditions. The measured run created zero companies and zero project links;
verified resolution used database provenance and canonical-company attachment.

## Required summary

- COMPANIES: 10
- EXISTING USABLE LINKEDIN: 1
- COMPANIES REQUIRING RESOLUTION: 9
- TAVILY CALLS: 9
- CANDIDATE PROFILES FOUND: 38
- VERIFIED NEW: 9
- VERIFIED EXISTING: 1
- PROBABLE: 0
- AMBIGUOUS: 0
- NOT FOUND: 0
- WRONG: 0
- TOTAL SAFE LINKEDIN COVERAGE: 10/10
- WRONG PROFILES ACCEPTED: 0
- LINKEDIN AS CANONICAL DOMAIN: 0
- AVERAGE CALLS/RESOLVED COMPANY: 1
- TOTAL COST: $0.0900
- COST/VERIFIED PROFILE: $0.0090
- PROVENANCE: PASS
- ENTITY SAFETY: PASS
- BRIGHT DATA CALLS: 0
- EXA CALLS: 0
- APIFY CALLS: 0
- CONTACT ENRICHMENT: 0
- SIGNALS: 0
- BUYING INTENT: 0
- PRODUCTION OPERATIONS: 0

## Resolution table

| Company | Canonical domain | Before LinkedIn URL | Historical pre-resolution LinkedIn URL | Existing identifier status | Search required | Search calls | Current run provider calls | Candidates found | Selected candidate | Name match | Domain match | Geography match | Contradictions | Final status | Confidence | Current canonical persistence | Historical canonical persistence | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cloudflare | cloudflare.com | https://www.linkedin.com/company/cloudflare | NONE | NO_LINKEDIN_URL | YES | 1 | 0 | 1 | https://www.linkedin.com/company/cloudflare | YES | YES | NO | NONE | VERIFIED | 85 | NO_CANONICAL_CHANGE | ATTACHED_VERIFIED | Candidate title or slug agrees with "Cloudflare"; The indexed candidate evidence references canonical domain "cloudflare.com" |
| Panopta | fortinet.com | https://www.linkedin.com/company/panopta-llc | NONE | NO_LINKEDIN_URL | YES | 1 | 0 | 4 | https://www.linkedin.com/company/panopta-llc | YES | YES | NO | NONE | VERIFIED | 85 | NO_CANONICAL_CHANGE | ATTACHED_VERIFIED | Candidate title or slug agrees with "Panopta"; The indexed candidate evidence references canonical domain "fortinet.com" |
| Amazon Web Services (AWS) | UNKNOWN | https://linkedin.com/company/amazon-web-services | https://www.linkedin.com/company/amazon-web-services | VERIFIED_EXISTING | NO | 0 | 0 | 0 | https://www.linkedin.com/company/amazon-web-services | NO | NO | NO | NONE | VERIFIED_EXISTING | 100 | NO_CANONICAL_CHANGE | NO_CANONICAL_CHANGE | Existing verified LinkedIn company identifier was reused without a provider call |
| Oracle Cloud | oracle.com | https://www.linkedin.com/company/oracle | NONE | NO_LINKEDIN_URL | YES | 1 | 0 | 1 | https://www.linkedin.com/company/oracle | YES | YES | NO | NONE | VERIFIED | 85 | NO_CANONICAL_CHANGE | ATTACHED_VERIFIED | Candidate title or slug agrees with "Oracle Cloud"; The indexed candidate evidence references canonical domain "oracle.com" |
| Alibaba Cloud | alibabacloud.com | https://www.linkedin.com/company/alibaba-cloud-computing-company | NONE | NO_LINKEDIN_URL | YES | 1 | 0 | 1 | https://www.linkedin.com/company/alibaba-cloud-computing-company | YES | YES | NO | NONE | VERIFIED | 85 | NO_CANONICAL_CHANGE | ATTACHED_VERIFIED | Candidate title or slug agrees with "Alibaba Cloud"; The indexed candidate evidence references canonical domain "alibabacloud.com" |
| E2E Cloud | e2enetworks.com | https://www.linkedin.com/company/e2enetworks | NONE | NO_LINKEDIN_URL | YES | 1 | 0 | 7 | https://www.linkedin.com/company/e2enetworks | YES | YES | NO | NONE | VERIFIED | 85 | NO_CANONICAL_CHANGE | ATTACHED_VERIFIED | Candidate title or slug agrees with "E2E Cloud"; The indexed candidate evidence references canonical domain "e2enetworks.com" |
| Cloud4C Services | cloud4c.com | https://www.linkedin.com/company/cloud4c | NONE | NO_LINKEDIN_URL | YES | 1 | 0 | 9 | https://www.linkedin.com/company/cloud4c | YES | YES | NO | NONE | VERIFIED | 85 | NO_CANONICAL_CHANGE | ATTACHED_VERIFIED | Candidate title or slug agrees with "Cloud4C Services"; The indexed candidate evidence references canonical domain "cloud4c.com" |
| Emergys | emergys.com | https://www.linkedin.com/company/emergys-llc | NONE | NO_LINKEDIN_URL | YES | 1 | 0 | 1 | https://www.linkedin.com/company/emergys-llc | YES | YES | NO | NONE | VERIFIED | 100 | NO_CANONICAL_CHANGE | ATTACHED_VERIFIED | Candidate title or slug agrees with "Emergys"; The indexed candidate evidence references canonical domain "emergys.com"; The canonical website result references the same LinkedIn company profile |
| ENTUNE IT Consulting Pvt Ltd | entune.co | https://www.linkedin.com/company/entune | NONE | NO_LINKEDIN_URL | YES | 1 | 0 | 6 | https://www.linkedin.com/company/entune | YES | YES | NO | NONE | VERIFIED | 85 | NO_CANONICAL_CHANGE | ATTACHED_VERIFIED | Candidate title or slug agrees with "ENTUNE IT Consulting Pvt Ltd"; The indexed candidate evidence references canonical domain "entune.co" |
| Cloudi | cloudi-infra.com | https://www.linkedin.com/company/cloudi-infra | NONE | NO_LINKEDIN_URL | YES | 1 | 0 | 8 | https://www.linkedin.com/company/cloudi-infra | YES | YES | NO | NONE | VERIFIED | 85 | NO_CANONICAL_CHANGE | ATTACHED_VERIFIED | Candidate title or slug agrees with "Cloudi"; The indexed candidate evidence references canonical domain "cloudi-infra.com" |

## Manual audit evidence

### Cloudflare

- Status: VERIFIED
- Selected candidate: https://www.linkedin.com/company/cloudflare
- Discovery query: site:linkedin.com/company "Cloudflare" "cloudflare.com"
- Search result title: Cloudflare - LinkedIn
- Search result URL: https://www.linkedin.com/company/cloudflare
- Search result excerpt: ## Overview
Cloudflare, Inc. (NYSE: NET) is the leading connectivity cloud company. It empowers organizations to make their employees, applications and networks faster and more secure everywhere, while reducing complexity and cost. Cloudflare’s connectivity cloud delivers the most full-featured, unified platform of cloud-native products and developer tools, so any organization can gain the control
- Retrieved at: 2026-08-31T08:49:05.812Z
- Reason: Candidate title or slug agrees with "Cloudflare"; The indexed candidate evidence references canonical domain "cloudflare.com"
- Supporting evidence: NAME_MATCH, DOMAIN_MATCH
- Contradicting evidence: NONE

### Panopta

- Status: VERIFIED
- Selected candidate: https://www.linkedin.com/company/panopta-llc
- Discovery query: site:linkedin.com/company "Panopta" "fortinet.com"
- Search result title: Panopta - We're excited to have joined the Fortinet team. https://www.fortinet.com/products/fortinet-acquires-panopta
- Search result URL: https://www.linkedin.com/company/panopta-llc
- Search result excerpt: # Panopta
We're excited to have joined the Fortinet team. 
Information Technology & Services • Chicago, IL • 3,564 followers • 11-50 employees

## Overview
Panopta is changing the way businesses monitor their network, servers, and applications with our advanced infrastructure monitoring platform. The rapid emergence of hybrid infrastructure environments has put a significant strain on operations t
- Retrieved at: 2026-08-31T08:49:07.132Z
- Reason: Candidate title or slug agrees with "Panopta"; The indexed candidate evidence references canonical domain "fortinet.com"
- Supporting evidence: NAME_MATCH, DOMAIN_MATCH
- Contradicting evidence: NONE

### Amazon Web Services (AWS)

- Status: VERIFIED_EXISTING
- Selected candidate: https://www.linkedin.com/company/amazon-web-services
- Discovery query: EXISTING IDENTIFIER
- Search result title: Existing verified identifier
- Search result URL: https://www.linkedin.com/company/amazon-web-services
- Search result excerpt: Existing verified identifier reused without search
- Retrieved at: 2026-08-31T09:07:13.514Z
- Reason: Existing verified LinkedIn company identifier was reused without a provider call
- Supporting evidence: EXISTING_IDENTIFIER
- Contradicting evidence: NONE

### Oracle Cloud

- Status: VERIFIED
- Selected candidate: https://www.linkedin.com/company/oracle
- Discovery query: site:linkedin.com/company "Oracle Cloud" "oracle.com"
- Search result title: Oracle
- Search result URL: https://www.linkedin.com/company/oracle
- Search result excerpt: Oracle is a global leader in AI, delivering the cloud infrastructure, data, and applications that organizations across the world trust to successfully achieve business outcomes at scale. Oracle Cloud Infrastructure (OCI) provides fast, flexible, scalable AI infrastructure. With superior compute performance and network design, a comprehensive choice of AI services for developing and orchestrating a
- Retrieved at: 2026-08-31T08:49:07.401Z
- Reason: Candidate title or slug agrees with "Oracle Cloud"; The indexed candidate evidence references canonical domain "oracle.com"
- Supporting evidence: NAME_MATCH, DOMAIN_MATCH
- Contradicting evidence: NONE

### Alibaba Cloud

- Status: VERIFIED
- Selected candidate: https://www.linkedin.com/company/alibaba-cloud-computing-company
- Discovery query: site:linkedin.com/company "Alibaba Cloud" "alibabacloud.com"
- Search result title: Alibaba Cloud | LinkedIn
- Search result URL: https://www.linkedin.com/company/alibaba-cloud-computing-company
- Search result excerpt: Founded in 2009, Alibaba Cloud is a leading cloud computing and artificial intelligence company. Leveraging its proprietary Apsara Cloud operating system, Alibaba Cloud offers a comprehensive suite of cloud services based on a three-tiered architecture of Infrastructure-as-a-Service (IaaS), Platform-as-a-Service (PaaS) and Model-as-a-Service (MaaS) to customers worldwide. Alibaba Cloud is the larg
- Retrieved at: 2026-08-31T08:49:07.847Z
- Reason: Candidate title or slug agrees with "Alibaba Cloud"; The indexed candidate evidence references canonical domain "alibabacloud.com"
- Supporting evidence: NAME_MATCH, DOMAIN_MATCH
- Contradicting evidence: NONE

### E2E Cloud

- Status: VERIFIED
- Selected candidate: https://www.linkedin.com/company/e2enetworks
- Discovery query: site:linkedin.com/company "E2E Cloud" "e2enetworks.com"
- Search result title: E2E Cloud - Supercharge your AI workloads with E2E Cloud
- Search result URL: https://in.linkedin.com/company/e2enetworks
- Search result excerpt: E2E Cloud is amongst India's fastest growing accelerated computing platform in India. E2E Networks High-Performance cloud platform can be accessed via self-service portal at  where you can provision/manage and monitor Linux/Windows/GPU Cloud Machines with high performance CPU, large memory(RAM) or Smart Dedicated Compute featuring dedicated CPU cores. We began in 2009 as a contractless computing p
- Retrieved at: 2026-08-31T08:49:08.304Z
- Reason: Candidate title or slug agrees with "E2E Cloud"; The indexed candidate evidence references canonical domain "e2enetworks.com"
- Supporting evidence: NAME_MATCH, DOMAIN_MATCH
- Contradicting evidence: NONE

### Cloud4C Services

- Status: VERIFIED
- Selected candidate: https://www.linkedin.com/company/cloud4c
- Discovery query: site:linkedin.com/company "Cloud4C Services" "cloud4c.com"
- Search result title: Cloud4C Services - World’s Leading Automation-driven, Application Focused Cloud Managed Services Provider (MSP)
- Search result URL: https://sg.linkedin.com/company/cloud4c
- Search result excerpt: Cloud4C, part of Capgemini, is a global leader in AI-powered, automation-driven, application-centric managed services and cloud infrastructure, delivering Sovereign and Secure Industry Hybrid Cloud solutions across 25 countries. Headquartered in Singapore, Cloud4C supports 2500+ enterprises—including 50+ Global Fortune 1000 firms—with end-to-end transformation under a Single SLA covering cloud, cy
- Retrieved at: 2026-08-31T08:49:08.553Z
- Reason: Candidate title or slug agrees with "Cloud4C Services"; The indexed candidate evidence references canonical domain "cloud4c.com"
- Supporting evidence: NAME_MATCH, DOMAIN_MATCH
- Contradicting evidence: NONE

### Emergys

- Status: VERIFIED
- Selected candidate: https://www.linkedin.com/company/emergys-llc
- Discovery query: site:linkedin.com/company "Emergys" "emergys.com"
- Search result title: News | Emergys
- Search result URL: https://www.emergys.com/news
- Search result excerpt: June 17, 2025

  ### Emergys announces the official name change of its integrated entity in Germany
 Platinum Partnership Automation Anywhere

  April 22, 2025

  ### Platinum Partnership Automation Anywhere
 Finalist for 2025 SAP Pinnacle Award

  April 10, 2025

  ### Emergys Named a Finalist for 2025 SAP® Pinnacle Awards in the Rising Star Category
 Press release entity in Dubai

  March 24, 20
- Retrieved at: 2026-08-31T08:49:08.792Z
- Reason: Candidate title or slug agrees with "Emergys"; The indexed candidate evidence references canonical domain "emergys.com"; The canonical website result references the same LinkedIn company profile
- Supporting evidence: NAME_MATCH, DOMAIN_MATCH, OFFICIAL_WEBSITE_LINK
- Contradicting evidence: NONE

### ENTUNE IT Consulting Pvt Ltd

- Status: VERIFIED
- Selected candidate: https://www.linkedin.com/company/entune
- Discovery query: site:linkedin.com/company "ENTUNE IT Consulting Pvt Ltd" "entune.co"
- Search result title: ENTUNE IT Consulting Pvt Ltd - Your Partner for Success...
- Search result URL: https://in.linkedin.com/company/entune
- Search result excerpt: # ENTUNE IT Consulting Pvt Ltd
Your Partner for Success...
IT Services and IT Consulting • Bengaluru, Karnataka • 5,031 followers • 51-200 employees

## Overview
ENTUNE IT Consulting Pvt Ltd (ENTUNE) based out of Bangalore, India was founded in 2015 with the core objective of offering top class Enterprise Solutions to the Mid-market and Large Enterprise segments. We aim to provide efficient and af
- Retrieved at: 2026-08-31T08:49:09.029Z
- Reason: Candidate title or slug agrees with "ENTUNE IT Consulting Pvt Ltd"; The indexed candidate evidence references canonical domain "entune.co"
- Supporting evidence: NAME_MATCH, DOMAIN_MATCH
- Contradicting evidence: NONE

### Cloudi

- Status: VERIFIED
- Selected candidate: https://www.linkedin.com/company/cloudi-infra
- Discovery query: site:linkedin.com/company "Cloudi" "cloudi-infra.com"
- Search result title: Cloudi - We help organizations rethink their IT strategies and plan the technologies that best fit their business requirements.
- Search result URL: https://in.linkedin.com/company/cloudi-infra
- Search result excerpt: ## Overview
Cloudi s a Strategic Managed Services Provider (MSP) distinct for its ability to merge its vision & think tank with that of its clients strives to understand your business thoroughly, We offer exclusively tailored, comprehensive and effective strategies for business consulting and IT services dedicated to serving businesses with Innovative and Simple business Solutions that nurture pro
- Retrieved at: 2026-08-31T08:49:09.277Z
- Reason: Candidate title or slug agrees with "Cloudi"; The indexed candidate evidence references canonical domain "cloudi-infra.com"
- Supporting evidence: NAME_MATCH, DOMAIN_MATCH
- Contradicting evidence: NONE

## Cost and cache

- Recorded initial-resolution Tavily calls: 9
- Current database-cache replay Tavily calls: 0
- Immediate idempotency replay Tavily calls: 0
- First-run cache hits: 9
- Idempotency replay cache hits: 9
- Persisted verified cache replay: true
- Average latency per Tavily call: 0 ms

## Safety

Database deltas are reported below. Canonical company row updates are permitted only
for VERIFIED development results; no new companies or project-company rows are created.

```json
{
  "researchJobs": 0,
  "evidenceRows": 0,
  "contactEnrichmentAttempts": 0,
  "signals": 0,
  "opportunityScores": 0,
  "companies": 0,
  "projectCompanies": 0
}
```

## Decision

DECISION A: PROFILE RESOLUTION PASSES. Proceed to the chained Profile Resolution → Bright Data Firmographics evaluation in a separate test.
