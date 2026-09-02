# JYRA Market Readiness

Market Readiness campaigns are an explicit, project-scoped control plane for
validating **JYRA_INTELLIGENCE_V2**. A campaign is not launch-ready until every
readiness and commercial gate described below passes. New
campaigns default to automatic fresh discovery, a target of 200, manual
outcomes, and a hard USD 50.00 cap (5,000 integer cents).

The lifecycle is deterministic and explicitly driven: `PLANNED` starts as
`DISCOVERING`; a settled discovery attempt moves to `RUNNING` only at exactly
200 unique cohort items; each explicit advance in `RUNNING` processes at most
one item; and the campaign moves to `REVIEWING` only with 200 scoped,
successful, exact-cost prediction snapshots and no pending or leased attempts.
No phase transition automatically dispatches provider work. Pausing preserves
whether discovery or processing should resume.

Creating, pausing, freezing, reviewing, and importing outcomes do not spend
money. An explicit Advance may run one adapter-backed paid attempt; lifecycle
transitions themselves never invoke a provider. Before an attempt starts it must reserve
the cost transactionally; spent plus reserved can never exceed the campaign
cap.  Discovery pages are bounded to 50 candidates and domains are normalized
and deduplicated.

V2 processing is fail-closed unless
`MARKET_READINESS_V2_SEMANTIC_MAX_CENTS` is configured as a positive integer.
The expected development value is `5` cents per semantic attempt. The server
validates it at startup when `MARKET_READINESS_PROCESSING_ENABLED=true` and
again when processing is explicitly requested; it is intentionally not
defaulted by the application.

Processing reserves the complete reachable V2 graph before execution: one
website crawl, one firmographic request, four web searches (two direct and two
reachable through company-profile resolution), and both bounded semantic
attempts. Provider-call counts are shared constants used by reservation logic.

Freezing stores a SHA-256 digest over the ordered cohort and makes campaign
configuration immutable. It requires exactly 200 scoped items and exactly one
adjudication and immutable prediction snapshot for every item. Gold reviews use opaque cohort keys and deliberately
do not contain model predictions.  Assignment is deterministic from an
experiment seed and cohort stratum.  Promotion fails closed until freeze,
readiness, the campaign's single completed experiment has exactly 200 unique
assignments split 100/100, and commercial gates all pass. If no
existing staff gate is installed, rollout authorization must be restricted to
the project organization owner or admin.

Each assignment accepts exactly one terminal outreach outcome: meeting,
opportunity, bad fit, or other. Outcomes may be entered manually or imported
from `domain,outcome,occurred_at` CSV after the experiment starts. Experiment
start is persisted once and cannot be moved; every outcome occurrence must be
on or after it. Evaluation
requires all 200 assignments to have unambiguous outcomes, at least a
25-percentage-point treatment lift in meetings or opportunities, and no
increase in bad-fit outreach. Missing, duplicate, cross-campaign, or
pre-experiment outcomes keep rollout blocked.

Every prediction snapshot contains one strict evaluation record derived from
the final V2 identity, seller-relative assessment, safety output, evidence,
terminal state, actual provider/model usage, and version/input fingerprints.
Incomplete or internally inconsistent records are rejected by validation and
database triggers. Every snapshot must link a same-scope, same-item succeeded
processing attempt whose actual cents equal the persisted total cost. Rollout
reparses every record and validates that attempt unconditionally. Dangerous
competitor-as-buyer is derived as a comparison between adjudicated competitor
gold and the persisted buyer prediction; it is never trusted as a self-reported
prediction flag. Missing, invalid, failed, unsupported, dangerous, or
cost-mismatched records fail closed with explicit reasons; rollout never
substitutes success or zero-cost defaults.

Expired leases are never redispatched. The next advance call atomically fences
the attempt as `FAILED` with
`LEASE_EXPIRED_RECONCILIATION_REQUIRED`, books its full reservation as spent,
and blocks the campaign without invoking an adapter. A delayed stale worker
cannot report success or write a snapshot. If it later reports a cost above the
booked reservation, only the positive delta is added so full actual cost is
recorded without double-counting; lower costs retain the conservative booking.
Explicit resume requires sufficient remaining cap and creates an idempotent
fresh retry attempt rather than reusing the fenced attempt.

After schema push and invariant application against the approved development
database, run the isolated, self-cleaning concurrency suite with:

`pnpm run test:market-readiness:db`

The suite uses synthetic database records and adapters only; it never calls a
provider.
