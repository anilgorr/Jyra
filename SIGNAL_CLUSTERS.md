# Signal Cluster Engine

## Boundary

A signal cluster is a deterministic, project-scoped interpretation of already detected signals. It does not replace individual signals, infer buying intent, predict outcomes, or score an opportunity. A cluster exists only when an active, customer-approved definition matches persisted signals.

## Definition

Each immutable definition version contains:

- required signal codes
- optional signal codes
- negative signal codes
- a minimum number of independent positive events
- a bounded temporal window
- default strength plus need and timing impacts
- optional negative handling configuration

AI may propose a definition inside an Opportunity Intelligence Pack. The proposal is inert until the customer creates a review revision, dispositions every cluster, approves the pack, and separately activates it. Customers can also create inactive definition versions directly and explicitly activate them.

## Deterministic evaluation

The evaluator:

1. Selects at most the latest observation for each configured signal code.
2. Requires every required code inside the configured time window.
3. Groups supporting observations by normalized source-content hash, falling back to fact, evidence, then signal identity.
4. Rejects a match unless the minimum independent-event count is met.
5. Invalidates a match when a configured negative signal occurs in the window, unless the definition explicitly uses `WEAKEN`.
6. Computes strength from configured strength and observed signal strength, applying a bounded negative penalty when relevant.
7. Upserts one result per company, project, definition, and definition version.

Syndicated or reposted source content with the same normalized content hash counts as one event. Multiple detections of the same configured signal code cannot inflate independence.

## Explainability and history

Every persisted cluster snapshots:

- triggered signal IDs and each member's role
- supporting evidence IDs
- event-group independence reasoning
- earliest/latest dates, span, and configured window
- generated explanation
- strength, confidence, impacts, status, and rule version

Definition edits create a new version. Activating a newer Opportunity Intelligence Pack version deactivates prior cluster definitions from that pack without rewriting historical clusters.

## Explicit exclusions

The engine contains no seller- or industry-specific branches. It does not implement predictive likelihood, recommendations, autonomous action, learning from outcomes, or Phase 14 behavior.