# JYRA — 50-Company MVP Reality Test 02
## Authoritative Fresh Rerun After Fix 05

## Final verdict

**G — MULTIPLE MATERIAL MVP DEFECTS**

## Execution

- Run ID: `4d1f4980-e17b-4251-a5b7-cddbb10ab8ae`
- Start: 2026-09-01T12:40:38.653Z
- End: 2026-09-01T13:15:20.624Z
- Runtime: 2082s
- Process exit: 0
- Production operations: 0
- Contact enrichment calls: 0

## Required funnel

**400 Raw Candidates → 400 Candidate Records → 0 classified Potential Buyers → 8 Unique Evaluable Companies → 8 Final Cohort → 5 LIKELY_FIT → 2 POSSIBLE_FIT → 5 Research Eligible → 5 Researched → 0 Companies With Approved Facts → 0 Companies With Supported Signals → 0 Companies With Supported Opportunities → 8 delivered Top accounts → 0 Useful Top accounts**

The product recorded buyer role as UNKNOWN during discovery. Independent review classified the eight final companies as **1 SELLER_COMPETITOR** and **7 ADJACENT_VENDOR**.

## Discovery and identity

- Raw candidates: 400
- Candidate records: 400
- Potential buyers: 0 independently confirmed in final cohort
- Seller/competitors: 1
- Adjacent vendors: 7
- Unknown buyer role in product output: 8
- Unique evaluable / final cohort: 8/50
- Discovery rounds: 40
- Confirmed firmographic matches: 7
- Profile ambiguity: 1
- Wrong firmographic attachments: 0
- Identity precision: 100% on the eight final records

Discovery exhausted the fresh market after excluding prior Reality Test and bounded-validation companies. This is a P1 coverage failure.

## WHO

- LIKELY_FIT: 5
- POSSIBLE_FIT: 2
- LIKELY_NOT_FIT: 0
- INSUFFICIENT_DATA: 1
- Approximate WHO useful agreement: 7/8 (87.5%)

SEQURETEK is the material WHO/buyer-role false positive: it is a security product/provider, not a Managed SOC buyer.

## Research

- Research eligible: 5 LIKELY_FIT; 0 POSSIBLE_FIT; 0 INSUFFICIENT_DATA
- Companies researched: 5
- Questions generated: 18
- Product question results: 18 succeeded, 0 timed out, 0 failed
- Product question success rate: 100%
- Cost-ledger provider rows: Tavily 19 failed; Exa 16 failed
- Provider failures recorded by performance artifact: 35

These two persisted views contradict each other and are recorded as a P1 research/accounting defect.

## Evidence, facts, and signals

- Retrieved evidence: 117
- Accepted evidence: 0
- Facts extracted: 14
- Facts approved: 0 demonstrated
- Companies with approved facts: 0
- Material signals: 1
- Independently supported: 0
- Unsupported: 1
- Seller-as-buyer: 1
- Wrong entity: 0
- Temporally invalid: 0
- Strict signal precision: **0%**

The sole active signal was SEQURETEK / `MSOC_SECURITY_STACK_CHANGE`. Independent review classifies it **SELLER_AS_BUYER**. Producing facts, a signal, and opportunities from evidence that remained RAW is a separate P1 lifecycle defect.

## Opportunity, WHEN, WHY, and NBA

- Opportunities created: 4
- Companies with supported opportunity evidence: 0
- CONTACT: 0
- MONITOR: 1
- RESEARCH_MORE: 3
- REVIEW: 0
- INSUFFICIENT_EVIDENCE explanations: 4
- Material positive WHY claims: 0
- WHY provenance boundary: 100% (no unsupported positive urgency claim)
- Mindteck failed during WHEN because raw content exceeded 500,000 characters

## Top-10 product test

Only eight accounts were available; ranks 9–10 are explicit coverage failures.

| Rank | Company | Buyer role | WHO | Signal validity | Usefulness | False positive |
|---:|---|---|---|---|---|---|
| 1 | SEQURETEK | SELLER_COMPETITOR | LIKELY_FIT | UNSUPPORTED | LOW | YES |
| 2 | enreap | ADJACENT_VENDOR | POSSIBLE_FIT | UNSUPPORTED | LOW | NO |
| 3 | Espire Infolabs | ADJACENT_VENDOR | INSUFFICIENT_DATA | UNSUPPORTED | LOW | NO |
| 4 | ESSPL | ADJACENT_VENDOR | LIKELY_FIT | UNSUPPORTED | LOW | NO |
| 5 | Mindteck | ADJACENT_VENDOR | LIKELY_FIT | UNSUPPORTED | LOW | NO |
| 6 | Sagarsoft (India) Ltd | ADJACENT_VENDOR | LIKELY_FIT | UNSUPPORTED | LOW | NO |
| 7 | Senrysa Technologies Limited | ADJACENT_VENDOR | LIKELY_FIT | UNSUPPORTED | LOW | NO |
| 8 | SRIT India Limited | ADJACENT_VENDOR | POSSIBLE_FIT | UNSUPPORTED | LOW | NO |
| 9 | No account | UNKNOWN | UNKNOWN | UNSUPPORTED | LOW | NO |
| 10 | No account | UNKNOWN | UNKNOWN | UNSUPPORTED | LOW | NO |

- HIGH usefulness: 0
- MEDIUM usefulness: 0
- LOW usefulness: 8 delivered accounts
- Useful: 0/10
- Useful opportunity rate: **0%**
- Clear false positives: 1/8 delivered (12.5%); 1/10 required slots (10%)
- Coverage: **UNUSABLE**

A salesperson receiving this output would not have a sufficiently broad or evidence-supported list for deciding where to spend time.

## Manual WHO review

All eight final companies were reviewed. Because the final cohort contained only eight companies, the required ten additional final-cohort reviews were impossible. Ten deterministic prior-cohort discovery records were reviewed without substituting them into product results: bswift, Gainsight, Ironclad, TeamSnap, Zapier, Zylo, LaunchDarkly, ClearCo, Vercel, and Onit. All ten are plausible potential buyers but were correctly excluded from this fresh cohort because they had appeared previously.

## Cost

- Research provider requests: 35
- Known research cost: $0.268
- Unknown-cost requests: 19
- Cost/final cohort company: $0.0335 known
- Cost/researched company: $0.0536 known
- Cost/supported signal: undefined (0 supported)
- Cost/useful Top-10 account: undefined (0 useful)

Discovery, profile-resolution, and firmographic costs are not included in the generated research-cost artifact and therefore are not claimed as known here.

## Performance

- Runtime: 2082s
- Discovery rounds: 40
- Provider timeouts: 0
- Provider failures: 35
- Process exit: 0

## Defects

- P0: 0
- P1: 4
- P2: 1
- P3: 0

Top five defects are recorded in `JYRA_50_COMPANY_MVP_REALITY_TEST_02_POST_FIX05_DEFECTS.csv`.

## Pass gates

- Identity precision ≥95%: PASS
- Wrong firmographic attachments = 0: PASS
- Strict signal precision ≥85%: **FAIL**
- WHY provenance = 100%: PASS (no material positive claims)
- Seller-as-buyer false signals = 0: **FAIL**
- Wrong-entity false signals = 0: PASS
- Temporally invalid signals = 0: PASS
- Top-10 useful opportunity rate ≥70%: **FAIL**
- Top-10 false-positive rate ≤10%: **FAIL among delivered accounts**
- Coverage ≥ ADEQUATE: **FAIL**
- No unresolved P0: PASS
- Production operations = 0: PASS

## Highest-impact repair areas

1. Restore fresh-market discovery coverage and prevent rapid exhaustion against prior cohorts.
2. Make provider outcomes, evidence acceptance, and downstream fact/signal eligibility internally consistent.
3. Enforce buyer-role classification before signal activation and ranking so sellers cannot become buyer opportunities.
