---
name: JYRA market-readiness gates
description: The required intelligence-quality, scale-reliability, and commercial-lift thresholds before JYRA is market ready.
---

JYRA is not market ready based on schema correctness or a small regression alone. Launch requires all three gates below.

## Intelligence-quality gate

- CommercialRole accuracy: at least 85%
- WHO accuracy: at least 80%
- POTENTIAL_BUYER precision: at least 90%
- POTENTIAL_BUYER recall: at least 80%
- Competitor recall: at least 90%
- Dangerous competitor-to-buyer errors: zero
- Competitors entering a positive buyer shortlist: zero
- CommercialRole coverage: at least 90%
- WHO coverage: at least 90%
- Identity resolution: at least 95%
- Evidence-backed actionable recommendations: 100%
- Unsupported or fabricated facts: zero
- Average research plus reasoning cost: preferably no more than $0.10 per company
- Processing success without manual intervention: at least 95%

For a 16-company diagnostic regression, the corresponding minimums are 14/16 CommercialRole, 13/16 WHO, 15/16 role coverage, 15/16 WHO coverage, at least 90% buyer precision, and zero competitor-to-buyer errors.

## Population-reliability gate

Run 200–500 fresh companies without manual correction. Each successful result must produce a traceable Company → WHO → CommercialRole → evidence → WHY → confidence chain, and the highest-ranked accounts must be directly usable by a salesperson.

## Commercial-outcome gate

Compare 100 JYRA-prioritized accounts against 100 accounts selected through normal ICP filters or tools such as Sales Navigator or Apollo. Require roughly 25–30% or greater improvement in meetings or opportunities per 100 accounts, with no material increase in bad-fit outreach.

Treat each assigned company as having exactly one terminal outcome, require all
200 outcomes before evaluation, and accept only outcomes that occurred on or
after the experiment's immutable start timestamp.

**Why:** Technical validity does not establish ranking utility or revenue
impact. Missing or duplicate outcomes distort arm rates, while historical
outcomes cannot establish lift caused by the field test. Small exposed holdouts
can diagnose failures but cannot prove generalization or commercial value.

**How to apply:** Keep V1 as the production default until a newly frozen blind
quality cohort passes, a fresh 200–500-company run passes reliability and cost
gates, and a controlled 100-versus-100 field test demonstrates commercial lift.
Persist experiment start once, reject earlier outcomes, and fail closed until
each arm has 100 unambiguous outcomes. Never reuse an exposed holdout as
unbiased launch evidence.