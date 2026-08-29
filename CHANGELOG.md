# Changelog

## JYRA rebrand

- Renamed the customer-facing product from DigiSignal to JYRA.
- Updated application metadata, navigation, authentication, onboarding, empty states, and product documentation.
- Preserved compatibility-sensitive internal identifiers such as the artifact directory, workspace package name, and local storage keys.

## Foundation

- Created the initial application shell.
- Added the contract-first foundation summary, capability phase, and activity endpoints.
- Added documentation for product boundaries, architecture, planned database model, signal vocabulary, provider routing, and security.
- Kept research, evidence, scoring, opportunity, enrichment, and learning features out of this milestone by design.

## Auth, organizations, and project shell

- Added Clerk sign-up, sign-in, session persistence, branded authentication screens, and logout.
- Added local users, organizations, organization memberships, and projects with transactional first-login onboarding.
- Added server-side membership checks for organization and project endpoints.
- Added organization and project creation plus project switching.
- Replaced the foundation navigation with Today, Opportunities, Companies, Business Twin, ICP, Research, Outcomes, and Settings.
- Preserved explicit empty states for all future intelligence workflows.

## Business Twin

- Added a project-scoped wizard for seller context, customer patterns, buying roles, urgency, differentiation, and objections while allowing unknown answers to remain blank.
- Added immutable Business Twin version history with raw-answer edits, validated AI regeneration, previous-version viewing, and manual interpretation refinement.
- Added tenant-authorized Business Twin APIs, separate raw/AI/manual storage, model and prompt metadata, and managed OpenAI output validation with bounded retry.
- Kept ICP, market research, providers, signals, opportunities, scoring, outcomes, and learning outside this milestone.

## Future entries

Future milestones should document user-visible behavior, schema changes, API contract changes, provenance implications, and any new trust boundary.