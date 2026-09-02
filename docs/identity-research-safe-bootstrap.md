# Identity Research-Safe Bootstrap

## Purpose

Task 113 repairs the circular identity deadlock in which an identifiable company
could not gather the public evidence needed to become attribution-safe because
research itself was blocked.

The repair is intentionally narrow. It changes identity permissions and the
Minimum Company Intelligence precondition only. It does not change providers,
queries, prompts, models, CommercialRole, WHO/ICP logic, Business Twins,
offerings, signal packs, signals, opportunities, contacts, or outreach.

## Trust levels

### `UNSAFE`

The target has no usable domain, has a malformed domain, has unresolved
collisions, or has any known contradictory identity evidence.

Allowed:

- No provider research.
- No canonical or downstream action.

### `RESEARCH_SAFE`

The target has:

- a syntactically valid normalized company domain;
- a legitimate domain association from first-party upload, coherent discovery,
  or an existing canonical company record; and
- no known contradiction or collision.

Allowed:

- bounded public company/profile research;
- project- and company-scoped provisional evidence.

Not allowed:

- canonical fact attachment;
- Company Understanding;
- CommercialRole;
- signals or opportunities;
- ranking;
- contact enrichment;
- outreach.

### `ATTRIBUTION_SAFE`

The target has no known conflict and has two independent associations:

1. a legitimate domain association or existing canonical-record association;
2. verified resolver, firmographic, or separately confirmed discovery evidence.

Only this level unlocks attribution-sensitive and downstream capabilities.

A sole confirmed discovery assertion remains `RESEARCH_SAFE`; it cannot promote
itself.

## Bootstrap flow

1. Normalize and validate the company domain.
2. Scan all available discovery and profile-resolution history for contradiction
   or unresolved ambiguity. Any known conflict is fail-closed.
3. If a legitimate association exists, grant `RESEARCH_SAFE`.
4. Run the existing bounded profile resolver.
5. Persist bootstrap output as private
   `COMPANY_PROFILE_RESOLUTION_REVIEW` provenance scoped to the current project
   and company. Do not update canonical company identifiers yet.
6. Reassess identity permissions using the immutable provisional evidence.
7. If the independent-corroboration rule passes, grant `ATTRIBUTION_SAFE` and
   attach the verified LinkedIn identifier.
8. Otherwise remain `RESEARCH_SAFE / INSUFFICIENT`, or transition to `UNSAFE`
   if contradiction or collision evidence appears.

Firmographics cannot run during a `RESEARCH_SAFE` bootstrap. It remains
available only when identity was already attribution-safe before the research
pass.

## Isolation and idempotency

- Evidence queries are constrained by both project ID and company ID.
- One candidate's evidence cannot satisfy another candidate.
- Minimum Company Intelligence retains its PostgreSQL advisory lock.
- The trust level is part of the cache fingerprint.
- Replays after promotion reuse the cached result and do not duplicate evidence
  or canonical promotion.
- Provenance is append-only; generic development integration fixtures are
  retained and explicitly labelled rather than illegally deleted.

## Generic verification

The deterministic Task 113 suite covers all 12 required generic cases,
including:

- imported exact-domain and coherent discovery bootstrap;
- missing, malformed, conflicting, and colliding identities;
- research permission without attribution permission;
- no premature signals, opportunities, ranking, contacts, or canonical facts;
- resolver-only non-promotion;
- verified corroboration promotion;
- historical conflict precedence;
- idempotent replay;
- cross-candidate isolation.

The development integration uses only generated generic identities and a
simulated normal profile-provider response. It proves:

- `RESEARCH_SAFE` before research;
- one bounded public profile search;
- one private, project/company-scoped provisional row;
- no firmographic call before reassessment;
- promotion to `ATTRIBUTION_SAFE` only after corroboration;
- no premature signals or opportunities;
- downstream eligibility only after promotion;
- cache-hit replay and zero duplicate promotions;
- no cross-candidate evidence leakage.

Task 112 predictions were not rescored. Their prediction artifact remains
byte-for-byte unchanged.