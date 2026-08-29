# Phase 13 — Generic Signal Cluster Engine

Approved signals may be combined only through customer-approved, versioned cluster definitions. Definitions configure required, optional, and negative signal codes, independent-event thresholds, and bounded temporal proximity. The deterministic evaluator preserves evidence, timing, independence, member roles, confidence, impacts, and an explanation snapshot. AI-generated cluster definitions are proposals and remain inert until customer review, pack approval, and separate activation. This phase does not add predictive likelihood, recommendations, buying intent, autonomous actions, learning, or other Phase 14 scope.

## Ideal Customer Profile engine

JYRA converts the current Business Twin into an explicit, project-scoped ICP. Criteria are grouped as must-have, preferred, disqualifier, or advisory rules. Scorable rules use validated dimensions, operators, values, ranges, and weights; advisory rules remain visible without silently affecting objective evaluation. Missing company facts evaluate as unknown rather than failure. Generation, acceptance, edits, additions, deletions, and regeneration each create a new immutable version.

## Canonical company identity

JYRA represents a real-world company once and links that canonical identity to any number of projects. Canonical names, normalized domains, websites, LinkedIn URLs, geography, industry, employee data, and descriptions are globally reusable. Research status, scores, signals, opportunity state, recommendations, and all other commercial interpretation remain private to the project.

Manual and CSV import use a preview-first workflow. Exact normalized domain matches reuse an existing canonical company. Similar names are shown as possible duplicates and require a user to explicitly reuse the candidate or create a separate company. Identity resolution never delegates merging to an LLM and never silently turns an uncertain match into a canonical merge.

## Evidence provenance layer

JYRA preserves public company observations in globally reusable crawl captures and evidence records before any downstream fact, signal, or commercial interpretation. Each observation retains its canonical company, normalized source URL and domain, source type, provider, publisher, publication and observation times, immutable raw content reference, source-grounded claim, deterministic heuristic scores, confidence, and review status.

Unchanged content from the same company and source is recognized by a deterministic normalized-content hash and is not processed again. Changed observations create new records rather than overwriting prior source material. Evidence may move through `RAW`, `EXTRACTED`, `VERIFIED`, `CONFLICTING`, and `STALE`; status review cannot rewrite the raw capture.

Authority, directness, freshness, and corroboration values are bounded heuristics for review support. They are not truth labels and do not create facts, signals, buying intent, opportunity scores, or recommendations. All evidence API access remains rooted in an authorized project-company relationship even though the preserved public observation is reusable for the same canonical company across projects.

## Structured fact extraction

JYRA can turn preserved evidence into reviewable structured facts for leadership, hiring, expansion, funding, acquisitions, certifications, compliance, technology, markets, customers, incidents, growth, and trust-center changes. Every fact references exactly one canonical company and one existing evidence record, carries a structured value, effective date, bounded confidence, verbatim supporting excerpt, extractor version, and creation time, and provides a direct path back to its source.

Managed AI is proposal-only. Strict JSON is retried only within a bounded extraction request and is never persisted directly. Application validation owns the supported vocabulary, company/evidence relationship, real calendar date, confidence range, excerpt presence in the immutable capture, and rejection of ambiguity or commercial interpretation. Facts remain distinct from signals, buying intent, opportunity scores, recommendations, and hypotheses.

Signal interpretation is also configuration-controlled. A reusable fact becomes a signal only when an approved definition in an explicitly selected project/offering Signal Pack matches it. Signal meaning is contextual to the customer's Business Twin, ICP, offering, pack, and project; no industry pack is universally or automatically applied.

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

### Business maturity and evidence

Business Twin supports `PRE_LAUNCH`, `LAUNCHED_NO_CUSTOMERS`, `EARLY_CUSTOMERS`, `REPEATABLE_SALES`, and `ESTABLISHED`. The wizard asks for maturity near the beginning and adapts the remaining questions. Pre-launch and zero-customer companies can complete a Twin from market hypotheses, prospective-customer conversations, design partners, pilots, and validation notes without inventing customers, deal sizes, win rates, or sales history.

Claims keep provenance separate from validation. Supported provenance includes founder hypothesis, customer interview, design partner, pilot, customer, CRM history, sales outcome, user confirmation, and AI inference. Validation remains one of untested, partially validated, validated, contradicted, or unknown. Early-customer conclusions use “early evidence suggests” language rather than claiming a definitive ideal customer.

Generated ICP versions are labeled `HYPOTHESIS_ICP`, `EARLY_EVIDENCE_ICP`, or `VALIDATED_ICP`. Mode selection is deterministic, exposes testable assumptions, contains no unsupported confidence percentage, and never silently rewrites an accepted version.

## Product phases

### 1. Business Twin and ICP (implemented)

The seller describes their offer, ideal customer profile, sales motion, exclusions, geography, and commercial constraints. AI may assist with interpretation and drafting, but the saved configuration must remain explicit and reviewable.

### 2. Canonical company identity (implemented), Market Universe and qualification (future)

JYRA identifies or imports candidate companies and evaluates whether they fit the seller’s explicit criteria before researching people. Company identity resolution is deterministic and auditable.

### 3. Research planning and provider routing (implemented)

The provider abstraction routes normalized capability requests to configured adapters, records each attempt, and supports deterministic fallback. The bounded Research Planner selects one highest-value due question, records budget and stopping decisions, preserves fresh provider results as immutable evidence, and validates proposal-only facts. Provider availability remains configuration-dependent.

### 4. Evidence (implemented), facts, and signals (future)

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