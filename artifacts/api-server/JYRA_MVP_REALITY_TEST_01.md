JYRA MVP REALITY TEST 01

FINAL VERDICT:
E — ENTITY / WHO FOUNDATION NEEDS WORK

COMPANIES:
50

LIKELY FIT:
7

POSSIBLE FIT:
0

LIKELY NOT FIT:
24

INSUFFICIENT:
19

PRIORITIZED:
0

MONITOR:
0

RESEARCH MORE:
7

NO ACTION:
0

SUPPORTED OPPORTUNITIES:
0

PARTIALLY SUPPORTED:
0

KNOWN CONTROL EVENTS:
10

CONTROL EVENTS DETECTED:
0

KNOWN-EVENT DETECTION RECALL:
0.0%

TOTAL SIGNALS:
0

TRUE SUPPORTED SIGNALS:
UNKNOWN

WEAK SIGNALS:
UNKNOWN

UNSUPPORTED SIGNALS:
UNKNOWN

SIGNAL PRECISION:
UNKNOWN

UNSUPPORTED SIGNAL RATE:
UNKNOWN

WRONG ENTITY ATTACHMENTS:
0

SELLER-AS-BUYER ERRORS:
UNKNOWN

WHY PROVENANCE:
UNKNOWN

TOP-10 ACTIONABLE:
0/7

CONTACTABLE PRIORITY ACCOUNTS:
N/A (0/0)

TOTAL PROVIDER CALLS:
813

TOTAL ESTIMATED COST:
$6.9215

TOTAL ACTUAL REPORTED COST:
PARTIAL_UNKNOWN (known $0.2450; 119/813 rows complete)

COST / COMPANY:
$0.1154

COST / PRIORITIZED ACCOUNT:
UNKNOWN

COST / SUPPORTED OPPORTUNITY:
UNKNOWN

IDEMPOTENT REPLAY:
PASS

PRODUCTION OPERATIONS:
0

TOP 3 BOTTLENECKS:
FACT_EXTRACTION (6); FIRMOGRAPHICS (4); DISCOVERY (2)

## Verdict basis

Manual frozen-record sample measured 80.0% canonical identity accuracy and 4/12 obvious ICP classification errors.

## Market discovery and canonical identity

- Raw discovered candidates: 250
- Accepted candidates: 230
- Canonical candidates: 230
- Duplicates rejected: 20
- Identity failures/rejections: 0
- Persisted discovery provenance records: 218
- Final population: 50
- Manual canonical identity accuracy: 80.0% (8/10; 2 not adjudicable)
- Incorrect or ambiguous sampled identities: 2/10
- Wrong identity attached: 0
- Ambiguous blocked: 0
- Verified domains: 45/50
- Verified LinkedIn URLs: 31/50
- Firmographic provider matches: 31/50
- Manual review sample: 12 companies; {"LIKELY_FIT":4,"LIKELY_NOT_FIT":4,"INSUFFICIENT_DATA":4}

### Manual identity and ICP adjudications

- **SecureSky** — identity: CORRECT; ICP: OBVIOUS_ERROR; Persisted name, securesky.com domain, verified LinkedIn profile, and confirmed firmographic name/domain agree. The persisted 11-50 employee range is wholly below the frozen 100-2,000 range, so LIKELY_FIT is an obvious classification error.
- **Nio Stars Technologies LLP** — identity: CORRECT; ICP: OBVIOUS_ERROR; Persisted company/domain, verified LinkedIn profile, and confirmed provider identity agree. The persisted 11-50 employee range is wholly below the frozen minimum of 100, making LIKELY_FIT obviously incorrect.
- **Prokopto** — identity: CORRECT; ICP: OBVIOUS_ERROR; Persisted prokopto.io, verified profile, and confirmed provider name/domain agree. The persisted 11-50 employee range cannot overlap the frozen 100-2,000 range, so LIKELY_FIT is an obvious error.
- **Acoru** — identity: CORRECT; ICP: OBVIOUS_ERROR; Persisted acoru.com, verified profile, and confirmed provider identity agree. Persisted Spain geography is outside the frozen five geographies and 11-50 employees is below 100; LIKELY_FIT is obviously incorrect.
- **Truvo Cyber** — identity: CORRECT; ICP: NO_OBVIOUS_ERROR; Name/domain, verified profile, and confirmed firmographics agree. Persisted 2-10 size and Computer and Network Security industry support LIKELY_NOT_FIT despite the recorded geography dimension.
- **Simple IT Inc** — identity: CORRECT; ICP: NO_OBVIOUS_ERROR; Name, simpleitindy.com, verified profile, and confirmed provider identity agree. Persisted 2-10 employees is below the frozen range, supporting LIKELY_NOT_FIT.
- **AMARU** — identity: CORRECT; ICP: NO_OBVIOUS_ERROR; Name/domain, verified profile, and confirmed provider record agree. Persisted New Zealand geography and 11-50 size are outside the frozen ICP, supporting LIKELY_NOT_FIT.
- **Socure** — identity: CORRECT; ICP: NO_OBVIOUS_ERROR; socure.com, verified profile, and confirmed provider identity agree. Persisted Artificial Intelligence industry is outside the frozen industry list, so no obvious error is established.
- **Digital Maelstrom** — identity: NOT_ADJUDICABLE; ICP: NO_OBVIOUS_ERROR; A discovery name/domain exists, but profile resolution returned NOT_FOUND and no confirmed firmographics exist. Identity cannot be manually verified from allowed persisted evidence; INSUFFICIENT_DATA is appropriate.
- **Mandiant (part of Google Cloud)** — identity: INCORRECT_OR_AMBIGUOUS; ICP: NO_OBVIOUS_ERROR; The persisted label combines a company with its parent, has no domain, and profile resolution returned NOT_FOUND. It is not a safely resolved independent canonical identity; INSUFFICIENT_DATA does not overstate fit.
- **Managed Services - Monitoring 24/7** — identity: INCORRECT_OR_AMBIGUOUS; ICP: NO_OBVIOUS_ERROR; The persisted value is a service description rather than a resolved company, with no domain and a NOT_FOUND profile. It is not a defensible canonical company; INSUFFICIENT_DATA avoids a false fit.
- **Corsa** — identity: NOT_ADJUDICABLE; ICP: NO_OBVIOUS_ERROR; corsa.finance is persisted, but profile resolution is NOT_FOUND and no confirmed provider firmographics exist. The allowed evidence cannot establish canonical accuracy; INSUFFICIENT_DATA is appropriate.

## WHO quality

- Industry coverage: 62.0%
- Geography coverage: 62.0%
- Employee-size coverage: 62.0%
- Firmographic provenance/useful coverage: 62.0%
- ICP qualification coverage: 100.0%
- Obviously incorrect ICP classifications in sample: 4/12 (33.3%)
- Distribution: {"LIKELY_FIT":7,"POSSIBLE_FIT":0,"LIKELY_NOT_FIT":24,"INSUFFICIENT_DATA":19}

## WHEN / WHY quality

- Companies researched: 7
- Research questions planned: 28
- Research questions investigated: 28
- Terminal dispositions: {"SUCCEEDED":24,"FAILED":4,"DEFERRED":0,"ERROR":0}
- Deferred questions and reasons: NONE
- Provider calls: 32
- Raw results: UNKNOWN
- Question-relevant results: UNKNOWN
- Direct event evidence: 0
- Facts: 0
- Signals: 0
- Clusters: 0
- Hypotheses supported / partially supported / not supported / insufficient / unknown: 0 / 0 / 0 / 7 / 0
- Material WHY provenance: UNKNOWN

## Blind positive-control benchmark

- Frozen controls attempted / provisioned / evaluated: 10 / 8 / 10
- Specific events detected: 0
- Known-event detection recall: 0.0%
- Labels exposed during provisioning or research: false
- Miss attribution: {"DISCOVERY_FAILURE":2,"ENTITY_FAILURE":0,"QUERY_FAILURE":0,"PROVIDER_COVERAGE":0,"SOURCE_NOT_FOUND":2,"RESEARCH_STOPPED_TOO_EARLY":0,"FACT_EXTRACTION_FAILURE":6,"SIGNAL_MAPPING_FAILURE":0,"FRESHNESS_FAILURE":0,"OTHER":0}
- Four terminal question dispositions present for every provisioned control: true

- **SolarWinds** — MISSED; provision PROVISIONED; cause SOURCE_NOT_FOUND; evidence 0; facts 0; signals 0; terminal questions: LEADERSHIP=SUCCEEDED, HIRING=SUCCEEDED, EXPANSION=SUCCEEDED, TECHNOLOGY=SUCCEEDED
- **First Horizon** — MISSED; provision NOT_PROVISIONED; cause DISCOVERY_FAILURE; evidence 0; facts 0; signals 0; terminal questions: NONE
- **GitLab** — MISSED; provision PROVISIONED; cause FACT_EXTRACTION_FAILURE; evidence 1; facts 0; signals 0; terminal questions: LEADERSHIP=SUCCEEDED, HIRING=SUCCEEDED, EXPANSION=SUCCEEDED, TECHNOLOGY=SUCCEEDED
- **Infoblox** — MISSED; provision PROVISIONED; cause FACT_EXTRACTION_FAILURE; evidence 2; facts 0; signals 0; terminal questions: LEADERSHIP=SUCCEEDED, HIRING=SUCCEEDED, EXPANSION=SUCCEEDED, TECHNOLOGY=SUCCEEDED
- **Teradata** — MISSED; provision PROVISIONED; cause FACT_EXTRACTION_FAILURE; evidence 4; facts 0; signals 0; terminal questions: LEADERSHIP=SUCCEEDED, HIRING=SUCCEEDED, EXPANSION=SUCCEEDED, TECHNOLOGY=SUCCEEDED
- **Nubank** — MISSED; provision PROVISIONED; cause FACT_EXTRACTION_FAILURE; evidence 1; facts 0; signals 0; terminal questions: LEADERSHIP=SUCCEEDED, HIRING=SUCCEEDED, EXPANSION=SUCCEEDED, TECHNOLOGY=SUCCEEDED
- **Black Duck** — MISSED; provision PROVISIONED; cause FACT_EXTRACTION_FAILURE; evidence 14; facts 0; signals 0; terminal questions: LEADERSHIP=SUCCEEDED, HIRING=SUCCEEDED, EXPANSION=SUCCEEDED, TECHNOLOGY=SUCCEEDED
- **OpenAssets** — MISSED; provision PROVISIONED; cause FACT_EXTRACTION_FAILURE; evidence 2; facts 0; signals 0; terminal questions: LEADERSHIP=SUCCEEDED, HIRING=SUCCEEDED, EXPANSION=SUCCEEDED, TECHNOLOGY=SUCCEEDED
- **Black & McDonald** — MISSED; provision NOT_PROVISIONED; cause DISCOVERY_FAILURE; evidence 0; facts 0; signals 0; terminal questions: NONE
- **RAKBANK** — MISSED; provision PROVISIONED; cause SOURCE_NOT_FOUND; evidence 0; facts 0; signals 0; terminal questions: LEADERSHIP=SUCCEEDED, HIRING=SUCCEEDED, EXPANSION=SUCCEEDED, TECHNOLOGY=SUCCEEDED

## Signal precision review

- Emitted material signals: 0
- Strictly adjudicated signals: UNKNOWN
- TRUE_SUPPORTED: UNKNOWN
- WEAKLY_SUPPORTED: UNKNOWN
- UNSUPPORTED (including wrong entity, stale-current, and seller-as-buyer): UNKNOWN
- Signal precision: UNKNOWN
- Unsupported signal rate: UNKNOWN
- No precision is inferred merely from supporting IDs; absent strict adjudication remains UNKNOWN.

## Contact quality

- Accounts eligible / researched: 7 / 0
- Persisted contact attempts: 0
- Role hypotheses: N/A (0/0)
- People candidates: 0
- Confirmed / probable role matches: N/A (0/0) / N/A (0/0)
- Ambiguous / wrong contacts rejected: N/A (0/0) / N/A (0/0)
- LinkedIn / email / verified-or-probable email / phone coverage: N/A (0/0) / N/A (0/0) / N/A (0/0) / N/A (0/0)
- Fabricated contacts: 0

## Cost economics

- Unsuffixed TOTAL/COST PER scope: **COMBINED_BENCHMARK**
- DISCOVERY estimated / actual: $0.2450 / $0.2450
- PROFILE RESOLUTION estimated / actual: $1.6200 / PARTIAL_UNKNOWN (known $0.0000; 0/162 rows complete)
- FIRMOGRAPHICS estimated / actual: $0.0465 / PARTIAL_UNKNOWN (known $0.0000; 84/115 rows complete)
- WHEN/WHY estimated / actual: $5.0100 / PARTIAL_UNKNOWN (known $0.0000; 0/501 rows complete)
- CONTACT ENRICHMENT estimated / actual: $0.0000 / $0.0000
- OTHER estimated / actual: $0.0000 / $0.0000
- Total estimated / actual reported: $6.9215 / PARTIAL_UNKNOWN (known $0.2450; 119/813 rows complete)
- Actual-cost completeness: PARTIAL_UNKNOWN; known-stage subtotal $0.2450 (not presented as a complete total)
- Cost per benchmark company (denominator 60) / qualified / researched: $0.1154 / $0.9888 / $0.4614
- Cost per prioritized / contactable prioritized / materially supported opportunity: UNKNOWN / N/A (0/0) / UNKNOWN

### Population cost accounting

#### MAIN_POPULATION

- DISCOVERY: 25 calls; estimated $0.1750 (25/25); actual $0.1750
- PROFILE_RESOLUTION: 162 calls; estimated $1.6200 (162/162); actual PARTIAL_UNKNOWN (known $0.0000; 0/162 rows complete)
- FIRMOGRAPHICS: 115 calls; estimated $0.0465 (115/115); actual PARTIAL_UNKNOWN (known $0.0000; 84/115 rows complete)
- WHEN_WHY_RESEARCH: 464 calls; estimated $4.6400 (464/464); actual PARTIAL_UNKNOWN (known $0.0000; 0/464 rows complete)
- CONTACT_ENRICHMENT: 0 calls; estimated $0.0000 (0/0); actual $0.0000
- OTHER: 0 calls; estimated $0.0000 (0/0); actual $0.0000
- TOTAL: 766 calls; estimated $6.4815; actual PARTIAL_UNKNOWN (known $0.1750; 109/766 rows complete)

#### BLIND_CONTROLS

- DISCOVERY: 10 calls; estimated $0.0700 (10/10); actual $0.0700
- PROFILE_RESOLUTION: 0 calls; estimated $0.0000 (0/0); actual $0.0000
- FIRMOGRAPHICS: 0 calls; estimated $0.0000 (0/0); actual $0.0000
- WHEN_WHY_RESEARCH: 37 calls; estimated $0.3700 (37/37); actual PARTIAL_UNKNOWN (known $0.0000; 0/37 rows complete)
- CONTACT_ENRICHMENT: 0 calls; estimated $0.0000 (0/0); actual $0.0000
- OTHER: 0 calls; estimated $0.0000 (0/0); actual $0.0000
- TOTAL: 47 calls; estimated $0.4400; actual PARTIAL_UNKNOWN (known $0.0700; 10/47 rows complete)

#### COMBINED_BENCHMARK

- DISCOVERY: 35 calls; estimated $0.2450 (35/35); actual $0.2450
- PROFILE_RESOLUTION: 162 calls; estimated $1.6200 (162/162); actual PARTIAL_UNKNOWN (known $0.0000; 0/162 rows complete)
- FIRMOGRAPHICS: 115 calls; estimated $0.0465 (115/115); actual PARTIAL_UNKNOWN (known $0.0000; 84/115 rows complete)
- WHEN_WHY_RESEARCH: 501 calls; estimated $5.0100 (501/501); actual PARTIAL_UNKNOWN (known $0.0000; 0/501 rows complete)
- CONTACT_ENRICHMENT: 0 calls; estimated $0.0000 (0/0); actual $0.0000
- OTHER: 0 calls; estimated $0.0000 (0/0); actual $0.0000
- TOTAL: 813 calls; estimated $6.9215; actual PARTIAL_UNKNOWN (known $0.2450; 119/813 rows complete)

## Latency

- Benchmark interval: 2026-08-31T11:22:49.448Z to 2026-08-31T12:10:53.950Z
- Total test duration: 2884502 ms
- Average discovery-run latency: 1363.6666666666667 ms (15 runs)
- Average profile-resolution latency: 2068 ms (denominator 162)
- Average firmographic latency: 1508.4521739130435 ms (denominator 115)
- Average available WHO provider latency: 1835.6967509025271 ms (denominator 277)
- Average research-job latency: 3945.5806451612902 ms (denominator 31)
- Average contact-enrichment latency: N/A (denominator 0; zero persisted attempts)

## Controlled replay

- Exa calls: 0
- Tavily calls: 0
- Bright Data calls: 0
- Apify calls: 0
- Contact-provider calls: 0
- Total provider calls: 0
- Cache/idempotency hits: 28
- New evidence / facts / signals / contacts: 0 / 0 / 0 / 0
- Unexpected mutations: 0
- Replay result: PASS

## Safety

- Production operations: 0
- Wrong/ambiguous entity evidence attachments: 0
- Unsupported buying-intent claims: UNKNOWN
- Seller-as-buyer errors: UNKNOWN
- Fabricated evidence: UNKNOWN
- Fabricated people/contact details: 0
- Material WHY provenance: UNKNOWN

## Top 3 bottlenecks

1. **FACT_EXTRACTION** — 6; Known control events with matching evidence but no matching fact
2. **FIRMOGRAPHICS** — 4; Obvious ICP classification errors in the stratified frozen-record sample
3. **DISCOVERY** — 2; Frozen control identities not safely provisioned through normal discovery

## Top-10 sales table

Only 7 accounts legitimately qualified; no account was promoted to reach ten. Usefulness is explicitly classified from persisted accepted evidence, WHY, and contact availability.

| RANK | COMPANY | ICP FIT | OPPORTUNITY STATE | WHEN | WHY | CONFIDENCE | STRONGEST SIGNAL | FRESHEST EVENT | BUYER ROLE | PERSON | CONTACT AVAILABLE | NEXT BEST ACTION | EVIDENCE COUNT | RESEARCH COST | USEFULNESS |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---:|---:|---|
| 1 | SecureSky | LIKELY_FIT | WATCH | UNKNOWN | Insufficient evidence to establish current urgency. | MEDIUM | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | N/A_DENOMINATOR_0 | RESEARCH_MORE | 0 | $0.0400 | NOT_ACTIONABLE |
| 2 | Nio Stars Technologies LLP | LIKELY_FIT | WATCH | UNKNOWN | Insufficient evidence to establish current urgency. | MEDIUM | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | N/A_DENOMINATOR_0 | RESEARCH_MORE | 0 | $0.0400 | NOT_ACTIONABLE |
| 3 | Incrux Technologies Private Limited | LIKELY_FIT | WATCH | UNKNOWN | Insufficient evidence to establish current urgency. | MEDIUM | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | N/A_DENOMINATOR_0 | RESEARCH_MORE | 0 | $0.0400 | NOT_ACTIONABLE |
| 4 | IntellAxis AI | LIKELY_FIT | WATCH | UNKNOWN | Insufficient evidence to establish current urgency. | MEDIUM | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | N/A_DENOMINATOR_0 | RESEARCH_MORE | 0 | $0.0400 | NOT_ACTIONABLE |
| 5 | CyboSec Technologies | LIKELY_FIT | WATCH | UNKNOWN | Insufficient evidence to establish current urgency. | MEDIUM | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | N/A_DENOMINATOR_0 | RESEARCH_MORE | 0 | $0.0400 | NOT_ACTIONABLE |
| 6 | Prokopto | LIKELY_FIT | WATCH | UNKNOWN | Insufficient evidence to establish current urgency. | MEDIUM | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | N/A_DENOMINATOR_0 | RESEARCH_MORE | 0 | $0.0400 | NOT_ACTIONABLE |
| 7 | Acoru | LIKELY_FIT | WATCH | UNKNOWN | Insufficient evidence to establish current urgency. | MEDIUM | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | N/A_DENOMINATOR_0 | RESEARCH_MORE | 0 | $0.0800 | NOT_ACTIONABLE |

## Interpretation

Company fit, security activity, Managed SOC need, and buying intent are distinct. This report makes no actual purchase-intent claim without direct evidence.
