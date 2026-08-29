---
name: Opportunity Pack activation
description: Approval and activation boundaries for seller-specific Opportunity Intelligence Packs.
---

Opportunity Intelligence Pack generation must remain proposal-only. Customer approval freezes a reviewed version, while activation is a separate explicit operation that translates only approved items into configuration for the generic Signal Engine.

**Why:** AI-generated or customer-edited hypotheses must never silently affect detected signals or later opportunity scoring. Keeping the proposal record separate also preserves exactly what context and assumptions the customer reviewed.

**How to apply:** Generated proposals are immutable. Create an explicit customer review revision before edits or disposition changes; approval freezes that revision. Provider questions identify capabilities rather than vendors. Only an approved version may activate, and only approved signal items may become definitions.