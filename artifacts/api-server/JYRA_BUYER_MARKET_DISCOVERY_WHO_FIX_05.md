# JYRA Buyer-Market Discovery / WHO Qualification Fix 05

## Verdict

**CONDITIONAL PASS — BUYER DISCOVERY AND WHO MATERIALLY IMPROVED; 70-ROW REPLAY EVIDENCE INCOMPLETE**

Fix 05 repairs the observed Discovery → WHO failure without changing Research Planner,
Tavily/Exa research behavior, facts, signals, WHEN, WHY, opportunity scoring, NBA,
contacts, or outreach.

## What changed

- Added a provider-neutral buyer-market intent to discovery strategy:
  buyer company types, ICP industries/geographies/employee range, required and
  preferred characteristics, exclusions, seller/offering category exclusions,
  positive/negative concepts, confidence, and provenance.
- Replaced offering-centered queries with ICP-led market slices. The offering name
  is excluded from the positive discovery query.
- Added generic candidate relationship classification:
  `POTENTIAL_BUYER`, `SELLER_COMPETITOR`, `ADJACENT_VENDOR`, `PARTNER_POSSIBLE`,
  and `UNKNOWN`.
- Seller/competitor and adjacent-vendor results do not pass discovery
  prequalification merely because they match offering vocabulary.
- Centralized safe industry and geography aliases and employee-range parsing.
- Preserved missing evidence as `UNKNOWN`; unknown dimensions do not become
  negative fit.
- Preserved `POSSIBLE_FIT` and `INSUFFICIENT_DATA`. A fit with two known passing
  dimensions and one unknown is `LIKELY_FIT` at medium rather than falsely high
  confidence.
- Added an independent canonical-domain/verified-LinkedIn mismatch gate before
  firmographic persistence. Contradictory identifiers produce `WRONG` and cannot
  update canonical company data.
- Normal research handoff remains limited to `LIKELY_FIT`; the bounded validation
  intentionally stopped after WHO and did not exercise downstream intelligence.

## Original 70-candidate autopsy

The authoritative Fix 04 run reported 70 raw candidates and selected 50 companies.
The selected population was dominated by Managed SOC/security sellers because the
positive queries searched for companies relevant to the offering rather than for
companies in the ICP buyer market.

Offline replay artifact:
`JYRA_BUYER_MARKET_DISCOVERY_WHO_FIX_05_OFFLINE_REPLAY.json`

- Provider calls during replay: **0**
- Recoverable selected records: **50**
- Unavailable raw candidate bodies: **20**
- Seller/competitor: **40**
- Adjacent vendor: **3**
- Potential buyer: **7**
- Replayed WHO: **2 LIKELY_FIT**, **5 POSSIBLE_FIT**,
  **8 INSUFFICIENT_DATA**, **35 LIKELY_NOT_FIT**

The final Fix 04 report did not serialize the 20 unselected raw candidate bodies,
and discovery-run persistence retained counts/strategy rather than raw result
bodies. Therefore an exact 70-row offline replay cannot be reproduced from retained
evidence. This is an evidence-retention limitation, not silently replaced with
invented rows.

## Offline regressions

`pnpm run test:buyer-market-who-fix-05`

**20/20 passed**, covering:

1. Offering vocabulary does not dominate discovery.
2. Industry, geography, and size constrain buyer queries.
3. Seller/competitor and seller-category classification.
4. Missing firmographics remain unknown.
5. Wrong identity evidence remains blocked.
6. Industry/geography aliases and employee ranges normalize safely.
7. `LIKELY_FIT`, `POSSIBLE_FIT`, and `INSUFFICIENT_DATA` semantics.
8. Generic no-provider buyer/seller fixtures for Managed SOC, recruitment agency,
   ERP implementation, and commercial solar installation.
9. Fix 04 canonical handoff and known identity safety remain fail closed.

Additional regressions:

- Fix 04 handoff: **12/12 passed**
- Company identity: **100-row normalization set + regressions passed**
- Firmographic persistence/conflict/review/cache: **passed**
- ICP qualification: **passed**
- Typecheck: **passed**
- Production build: **passed**

## Single fresh 20-company validation

Run ID: `41ee95e9-4483-499d-9562-1f0009cd8a01`

Namespace:
`JYRA_50_COMPANY_MVP_REALITY_TEST_02_FIX_05_20`

This was the only fresh Fix 05 cohort. The full 50-company benchmark was not rerun.

### Population and WHO

- Population: **20/20**
- Plausible buyer companies: **12/20 (60%)**
- Adjacent vendors/service firms: **8/20 (40%)**
- Direct Managed SOC sellers/competitors: **0/20**
- `LIKELY_FIT`: **7**
- `POSSIBLE_FIT`: **8**
- `INSUFFICIENT_DATA`: **5**
- `LIKELY_NOT_FIT`: **0**
- Firmographic entity match `CONFIRMED`: **15**
- Firmographic entity match `WRONG`: **1**
- No safe firmographic result: **4**

Six of seven `LIKELY_FIT` companies were independently adjudicated as plausible
buyers. One (`Incture`) is an adjacent implementation/service vendor and is a
remaining WHO false positive.

### Improvement against Fix 04

| Metric | Fix 04 fresh 50 | Fix 05 fresh 20 |
|---|---:|---:|
| LIKELY_FIT | 0% | 35% |
| LIKELY_NOT_FIT | 66% | 0% |
| POSSIBLE_FIT | 14% | 40% |
| INSUFFICIENT_DATA | 20% | 25% |
| Direct seller/competitor pollution | dominant | 0% |
| Plausible buyer yield | very low | 60% |

The fresh population is materially more buyer-oriented and WHO now advances
plausible buyers without allowing every company into research.

### Cost and safety

- Company discovery calls: **3**, known cost **$0.021**
- Company-profile search calls: **20**, known cost **$0.302**
- Firmographic attempts: **16**
- WHEN/WHY research calls: **0**
- Contact enrichment calls: **0**
- Evidence/fact/signal/opportunity/NBA writes: **0**
- Production operations: **0**
- Environment: **development only**

The research-only cost artifact correctly reports zero because this WHO-only run
did not execute research. Discovery and profile costs above are derived from their
own provider response metadata.

### Harness limitation found after completion

The benchmark continuation harness appended an additional geographic suffix to a
query that already contained geography, producing one contradictory rendered query
(`United States ... in India`). Product discovery does not use that suffix. The
harness was corrected after the run; the completed cohort was not rerun, preserving
the one-fresh-validation constraint.

## Acceptance decision

The product repair is accepted for buyer-market discovery and WHO semantics:

- buyer discovery materially improved;
- seller pollution materially reduced;
- plausible buyers reach `LIKELY_FIT`/`POSSIBLE_FIT`;
- missing data remains non-negative;
- identity conflicts remain fail closed;
- no prohibited downstream subsystem changed.

The overall evidence verdict remains **conditional** because the required exact
70-candidate replay was impossible from the retained artifact. A future benchmark
must persist every raw candidate body (including unselected/rejected results) before
dispatch so its complete cohort can be replayed offline.