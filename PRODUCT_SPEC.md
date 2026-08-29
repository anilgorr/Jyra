## Ideal Customer Profile engine

JYRA converts the current Business Twin into an explicit, project-scoped ICP. Criteria are grouped as must-have, preferred, disqualifier, or advisory rules. Scorable rules use validated dimensions, operators, values, ranges, and weights; advisory rules remain visible without silently affecting objective evaluation. Missing company facts evaluate as unknown rather than failure. Generation, acceptance, edits, additions, deletions, and regeneration each create a new immutable version.

# JYRA Product Specification

## Product identity

JYRA is an Opportunity Intelligence platform for B2B sales teams that need to decide which small number of companies deserve attention now, when to approach them, and why.

Its product language is **Who. When. Why.**

## Product promise

JYRA continuously researches a seller’s market, detects evidence of commercial need and timing, identifies the companies that deserve attention, explains the reason, identifies relevant buyers, and learns from actual sales outcomes.

The product is not primarily a lead database, email scraper, cold-email platform, CRM, outreach sequencer, or generic AI research agent.

## Core information flow

```text
Business Twin
→ ICP
→ Market Universe
→ Company Qualification
→ Research Planner
→ Provider Router
→ Market Research
→ Evidence
→ Facts
→ Signals
→ Signal Clusters
→ Fit
→ Need
→ Timing
→ Relationship
→ Confidence
→ Opportunity Engine
→ Opportunity State
→ Why Now
→ Buying Committee
→ Contact Enrichment
→ Recommended Action
→ Outcome
→ Learning
```

## Implemented foundation and Business Twin

The implemented product includes authenticated users, JYRA-managed organizations and memberships, project-aware onboarding, and a versioned Business Twin for each selling motion.

Business Twin preserves the seller's raw answers separately from strictly validated AI interpretation and optional manual refinement. Editing answers, regenerating AI, or refining interpretation creates a new immutable version. Future intelligence areas remain explicit empty states: this milestone does not implement ICP, market research, company discovery, contact enrichment, scoring, opportunity recommendations, or sales outcome learning.

Missing intelligence remains missing rather than negative evidence. Empty counts, “not connected” states, and planned-phase messages are intentional.

## Product phases

### 1. Business Twin (implemented) and ICP (future)

The seller describes their offer, ideal customer profile, sales motion, exclusions, geography, and commercial constraints. AI may assist with interpretation and drafting, but the saved configuration must remain explicit and reviewable.

### 2. Market Universe and qualification

JYRA identifies or imports candidate companies and evaluates whether they fit the seller’s explicit criteria before researching people. Company identity resolution is deterministic and auditable.

### 3. Research planning and provider routing

The system plans the cheapest research capable of changing a decision, routes questions to approved providers, records provider cost, and applies stopping rules.

### 4. Evidence, facts, and signals

Research results preserve original source evidence. Structured facts, detected signals, interpretations, and hypotheses are stored separately.

### 5. Opportunity engine

Deterministic calculations combine fit, need, timing, relationship, and confidence. A generated “Why now” explanation must cite the evidence behind it.

### 6. Buying committee and action

Only after a company is commercially interesting does JYRA identify likely buyers, enrich contact data, and recommend an action.

### 7. Outcomes and learning

User-recorded outcomes improve future recommendations. They do not rewrite source evidence or silently change canonical company identity.

## Non-negotiable principles

1. Company first, people later.
2. Evidence before interpretation.
3. FACT, SIGNAL, INTERPRETATION, and HYPOTHESIS are separate concepts.
4. Important commercial conclusions must be explainable.
5. Every “Why now” statement is traceable to evidence.
6. Deterministic logic owns authorization, identity, scoring, billing, provenance, cost accounting, permissions, confidence, budgets, and stopping rules.
7. Missing information represents uncertainty; it is not proof of no need.
8. Public company intelligence may be reusable globally; customer-specific interpretations remain private.