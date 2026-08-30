---
name: Contact enrichment boundary
description: Privacy and eligibility rules for selective email and phone lookup.
---

Contact enrichment is secondary to company intelligence. Persist returned email and phone values only in project-scoped person context, while provider usage and private provenance record the lookup. Customer-uploaded profile URLs also stay in organization/project-scoped provenance rather than the global person identity namespace.

**Why:** Shared person records must not leak customer-specific contacts or uploaded profile identities across organizations, and broad enrichment would turn JYRA into a mass contact-harvesting product.

**How to apply:** Allow lookup only for a high-priority person or an explicit per-person user request. Email is the default capability, phone is opt-in, missing values remain null, and no lookup result may trigger outreach. Private imports must deduplicate within their scoped project/organization without reusing another organization's private person row.