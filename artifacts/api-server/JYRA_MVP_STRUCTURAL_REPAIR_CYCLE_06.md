# JYRA MVP Structural Repair — Cycle 06

## Final verdict

**B — PARTIAL PASS WITH ONE ISOLATED MATERIAL DEFECT**

Discovery coverage and eligible-buyer yield remain the isolated material
blocker. The latest bounded run constructed 18 evaluable project memberships,
not the required 50, and all 18 remained `UNKNOWN`. Consequently, the required
deterministic sample of five research-eligible `POTENTIAL_BUYER` companies
could not be constructed and mini research was not executed.

The accepted-evidence lifecycle and buyer-role downstream gates pass
deterministic structural tests. They do not have permitted live mini-research
validation in this adjudication because the cohort contained zero eligible
`POTENTIAL_BUYER` companies.

## Root causes

### Discovery exhaustion root cause

Normal provider discovery produced too few candidates, and historical global
canonical market records were initially unavailable to a fresh project run.
Public `JYRA_DISCOVERY` canonical reuse was added, but the semantics-aligned
bounded run still yielded only 18 evaluable memberships. Coverage therefore
remains below 50. In addition, all 18 memberships were classified `UNKNOWN`,
leaving eligible-buyer yield at zero.

### Lifecycle inconsistency root cause

Question results, provider-attempt accounting, and evidence acceptance
previously followed separate interpretations. An observer status could mark
attempts failed despite accepted merged output, and a missing attribution
review could allow a fact into accepted-fact selection. The repair makes the
persisted attempt/result authoritative and requires explicit accepted
attribution plus `VERIFIED` evidence.

### Seller-as-buyer root cause

Buyer role existed in transient discovery output but was not persisted through
research, signal activation, and opportunity ranking. Buyer role is now stored
on `project_companies`, and seller/adjacent roles are gated downstream.

## State diagrams

### Before

```text
provider result
  ├─ question = success
  ├─ observer/cost attempt = failed
  └─ evidence = raw or attribution absent
       └─ fact could be treated as accepted
            └─ signal
                 └─ positive buyer opportunity

discovery role (temporary)
  └─ canonical/project company (role lost)
       └─ seller could be researched and ranked as buyer
```

### After

```text
ResearchQuestion
  └─ ProviderAttempt(s), persisted in research_request_costs
       └─ merged retrieval result
            └─ one normalized terminal question result
                 └─ preserved evidence
                      ├─ RAW/unaccepted/rejected -> candidate only; STOP
                      └─ VERIFIED + explicit accepted attribution
                           └─ approved fact
                                └─ supported signal
                                     └─ supported opportunity evidence

provider candidate or PUBLIC discovery cache canonical
  └─ current-project qualification + buyer-role classification
       └─ project_companies.buyer_role
            ├─ POTENTIAL_BUYER -> normal downstream eligibility
            ├─ SELLER_COMPETITOR/ADJACENT_VENDOR -> buyer gates
            └─ UNKNOWN -> never coerced to POTENTIAL_BUYER
```

## Fix A — discovery

- Historical canonical reuse repaired: **PARTIAL**
- Prior-run/global-presence exclusion removed: **YES**
- Reuse boundary: only globally `PUBLIC` `JYRA_DISCOVERY` provenance
- Private/scoped provenance excluded: **YES**
- Current project qualification and buyer role recomputed: **YES**
- Global firmographics mutated during reuse: **NO**
- Current-run identity/company dedupe: **YES**
- Fresh 50-company cohort constructable: **NO**

### Adjudicated bounded-run result

| Metric | Result |
|---|---:|
| Run ID | `b538c7c9-961a-4466-b8eb-240e2fdd95c0` |
| Status | `SUCCEEDED` |
| Created | `2026-09-01T14:19:57.532Z` |
| Completed | `2026-09-01T14:19:59.739Z` |
| Provider calls | 6 |
| Raw candidates | 10 |
| Accepted/evaluable candidates | 18 |
| Current-run duplicates | 0 |
| Rejected candidates | 0 |
| Estimated cost | 0.042 |
| Actual cost | 0.088 |
| Unique evaluable | 18 |
| Final cohort | 18 |
| Can construct 50 | **NO** |

The run-level aggregate does not separately persist an adjudicated split for
historical canonical reused versus new canonical created, so those two values
are reported as **not separately available**, rather than inferred from the
10-to-18 increase.

Progression:

```text
pre-cache repair:              6 evaluable
first public-cache repair:    18 evaluable
final semantics-aligned run:  18 evaluable
required target:              50 evaluable
```

### Buyer-role outcome

| Persisted project role | Count |
|---|---:|
| `POTENTIAL_BUYER` | 0 |
| `SELLER_COMPETITOR` | 0 |
| `ADJACENT_VENDOR` | 0 |
| `PARTNER_POSSIBLE` | 0 |
| `UNKNOWN` | 18 |

Seller/competitor rejected by role in this run: **0 observed**. Adjacent-vendor
handling: the gate is implemented and deterministically tested, but no adjacent
vendor was classified in this run.

## Fix B — research lifecycle

- Single authoritative question terminal status: **YES, deterministic**
- Persisted provider-attempt ledger: **YES**
- Evidence acceptance gating: **YES, deterministic**
- Approved-fact gating: **YES, deterministic**
- Signal gating: **YES, deterministic**
- Opportunity-evidence gating: **YES, deterministic**
- Cost/performance derive from persisted attempts: **YES, deterministic**
- Permitted live mini validation: **NOT EXECUTED — zero eligible buyers**

### Provider-attempt model

Each persisted attempt carries provider, capability, request ID, question ID,
start/end, terminal status, result count metadata, known/unknown cost, error
metadata, and fallback metadata. A question may succeed when one attempt fails
and a fallback succeeds. Evidence acceptance remains independent of provider
request success. Cost and performance totals derive from the persisted
`research_request_costs` attempt rows.

### Evidence, fact, signal, and opportunity gates

1. Provider success does not itself accept evidence.
2. An approved fact requires `VERIFIED` evidence and an explicit accepted
   attribution review.
3. Raw, rejected, unaccepted, or attribution-less evidence cannot approve a
   fact.
4. Candidate fact proposals remain separate from approved facts.
5. A supported signal requires at least one accepted fact.
6. Positive supported opportunity evidence requires supported intelligence.
7. Seller/adjacent buyer-only activity is blocked before signals and ranking.

### Mini research adjudication

The harness requires exactly five deterministic, research-eligible
`POTENTIAL_BUYER` companies. The final cohort had zero, so it stopped before
research as designed.

| Mini-research metric | Result |
|---|---:|
| Companies | 0 |
| Questions | 0 |
| Question succeeded | 0 |
| Question failed | 0 |
| Provider attempts | 0 |
| Raw evidence | 0 |
| Accepted evidence | 0 |
| Candidate facts | 0 |
| Approved facts | 0 |
| Supported signals | 0 |
| Supported opportunity evidence | 0 |
| Supported opportunities | 0 |

Mini accounting reconciliation is **0 = 0**, but this is not evidence of live
fallback/provider reconciliation. That behavior is covered only by deterministic
structural tests in this adjudication.

## Fix C — buyer role

- Buyer role persisted with `UNKNOWN` default: **YES**
- Role updated during discovery/reuse: **YES**
- `SELLER_COMPETITOR` WHO protection: **YES, deterministic**
- Seller-as-buyer research/signal gate: **YES, deterministic**
- Seller opportunity-ranking gate: **YES, deterministic**
- Adjacent-vendor gate: **YES, deterministic**
- `UNKNOWN` coerced to buyer: **NO**
- Generic Managed SOC, recruitment, ERP, and solar fixtures: **4/4 PASS**

The live bounded run validates persistence of `UNKNOWN`, but cannot validate a
live potential-buyer research path because no membership was classified
`POTENTIAL_BUYER`.

## Safety invariants

| Invariant | Result |
|---|---|
| Supported signals with zero approved facts | 0 |
| Approved facts with zero accepted evidence | 0 |
| Seller-as-buyer signals | 0 |
| Wrong-entity firmographic attachments | 0 |
| Production operations | 0 |
| Contact enrichment | Disabled |
| Full 50-company Reality Test | Not run |

No provider was invoked while finalizing this report.

## Validation and regressions

| Suite/check | Result |
|---|---|
| Cycle 06 structural regressions | **24/24 PASS** |
| Fix 04 handoff suite | **12/12 PASS** |
| Fix 05 buyer discovery/WHO suite | **20/20 PASS** |
| Identity suite | **PASS** |
| Firmographic conflict suite | **PASS** |
| Semantic idempotency suite | **PASS** |
| Library and API typechecks | **PASS** |
| Build | **PASS** |
| Development schema push | **PASS** |

The Cycle 06 suite includes public-cache reuse, private/scoped exclusion,
current-run cache dedupe, seller exclusion, buyer-role propagation/gates,
provider terminal normalization, evidence/fact/signal gates, and bounded
coverage accounting.

## Cost consistency

The bounded discovery ledger reports estimated cost **0.042** and actual cost
**0.088** across **6** provider calls. No mini-research cost exists because no
research attempt ran. Therefore mini-research persisted attempt, cost, and
performance totals are all zero and internally equal.

## Files changed

- `lib/db/src/schema/companies.ts`
- `artifacts/api-server/src/lib/company-discovery.ts`
- `artifacts/api-server/src/lib/research.ts`
- `artifacts/api-server/src/lib/accepted-facts.ts`
- `artifacts/api-server/src/lib/signal-packs.ts`
- `artifacts/api-server/src/lib/opportunity-engine.ts`
- `artifacts/api-server/scripts/cycle-06-entry.ts`
- `artifacts/api-server/scripts/test-cycle-06-structural-repair.mjs`
- `artifacts/api-server/scripts/run-cycle-06-validation.mjs`
- `artifacts/api-server/scripts/run-cycle-06-validation-entry.ts`
- `artifacts/api-server/package.json`
- `artifacts/api-server/JYRA_MVP_STRUCTURAL_REPAIR_CYCLE_06.md`
- `artifacts/api-server/JYRA_MVP_STRUCTURAL_REPAIR_CYCLE_06.json`

## Scope and remaining limitation

The isolated remaining material defect is discovery coverage/eligible-buyer
yield: 18/50 evaluable and 0/5 research-eligible potential buyers. No query
tuning, provider changes, new providers, signal-definition changes, scoring
weight changes, NBA changes, contact enrichment, or full Reality Test were
performed.

Next work should address the bounded discovery coverage and role-classification
yield without weakening identity, evidence, or seller-as-buyer safety.
