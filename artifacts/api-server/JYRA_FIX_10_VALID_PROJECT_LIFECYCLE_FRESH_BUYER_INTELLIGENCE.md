# FIX 10 — Valid Project Lifecycle + Fresh Buyer Intelligence

## Final verdict: BLOCKED

Lifecycle and integrity controls passed. Buyer-intelligence quality did not meet the independent gate.

## Lifecycle and safeguards
- Concurrent activation is serialized and idempotent; one downstream signal definition, cluster definition, and project selection are created.
- Every Opportunity Pack proposal/mutator enforces actor membership, project/organization ownership, and child-reference scope inside the service.
- Pack proposal persistence revalidates the complete prompt context (Twin, ICP, criteria, approved public definitions) in a serializable transaction.
- Semantic decisions are serialized by exact fingerprint; terminal and no-call decisions are append-only and idempotent.
- Invalid legacy project remains unchanged. No contacts, WHEN/WHY, or 50-company test ran.

## Fresh 20-company result
- POTENTIAL_BUYER: 14
- SELLER_COMPETITOR: 0
- ADJACENT_VENDOR: 0
- PARTNER_POSSIBLE: 1
- UNKNOWN: 5
- UNKNOWN rate: 25%
- Exact provenance bindings: 20/20 unique
- Provenance-backed model decisions: 15
- No-call decisions: 5
- Current replay model calls: 0

## Independent adjudication
- POTENTIAL_BUYER: 10
- SELLER_COMPETITOR: 0
- ADJACENT_VENDOR: 2
- PARTNER_POSSIBLE: 6
- UNKNOWN: 2
- Exact role agreement: 11/20 (55%)
- Buyer precision: 8/14 (57.1%)
- Buyer recall: 8/10 (80%)

## Coverage and cost
- Trusted profiles: 15/20; firmographics: 13/20
- Identifiable profile misses: Espire Infolabs, bswift, Gainsight
- Discovery actual cost: $0.048
- Semantic diagnosis/replays: 58 calls, 151,133 tokens; dollar cost not persisted
- Pack generation and firmographic dollar costs: not persisted
- Contacts and WHEN/WHY: $0

## Why blocked
- Buyer precision is 57.1%, below the 80% validation bar.
- Exact five-class agreement is 55%, below the 70% validation bar.
- Three independently identifiable companies remained UNKNOWN because trusted profile evidence was not resolved in the normal run.
