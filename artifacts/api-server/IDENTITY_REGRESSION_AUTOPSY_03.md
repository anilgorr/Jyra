# IDENTITY REGRESSION AUTOPSY 03

## Final decision

**A — ACCEPTANCE RUNNER / PROVISIONING REGRESSION**

This is diagnosis only. No fix was applied and no acceptance or provider rerun occurred.

## Required summary

| Metric | Result |
|---|---:|
| Controls | 10 |
| Existing canonical found | 10 |
| Existing canonical reused | 0 |
| Failed run COMPANY_DISCOVERY calls | 10 |
| Raw results audited | 90 |
| Reference present / absent | 10 / 0 |
| Correct candidates blocked after retrieval | 10 |
| Discovery-rejected correct candidates | 0 |
| Top states CONFIRMED / PROBABLE / AMBIGUOUS / NOT_A_COMPANY / WRONG_ENTITY / UNRESOLVED | 0 / 9 / 1 / 0 / 0 / 0 |
| Safe-to-research but blocked | 10 |
| Normal identity regression reproduced | NO |
| Acceptance-runner divergence | YES |
| Primary stage | EXISTING_CANONICAL_NOT_REUSED / ACCEPTANCE_RUNNER_INTEGRATION_FAILURE |
| New provider calls | 0 |
| Production operations | 0 |

Secondary issues: KNOWN_ENTITY_SENT_TO_DISCOVERY; RUNNER_TREATED_NON_AUTO_ATTACH_COMPANY_ID_NULL_AS_NOT_PROVISIONED; RAW_PROVIDER_CANDIDATE_PAYLOADS_NOT_STORED; GITLAB_DUPLICATE_CANONICAL_DOMAINS_SECONDARY_DATA_QUALITY_ISSUE.

## Earliest break

All ten frozen controls already had canonical companies linked to **Aadit Technologies / GTM-Q1** in the approved development database. The runner in scripts/run-test-01-controls-entry.ts reduced each control to a name, did not perform an existing-canonical lookup, and always invoked discoverCompaniesForProject using capability COMPANY_DISCOVERY with the query `"<name>" official company`. It accepted only candidates satisfying both a non-null item.companyId and namesArePossibleDuplicates. Only after obtaining companyId would it check for an existing linked project-company. Therefore all ten pre-existing links were bypassed.

The earliest broken stage is **EXISTING_CANONICAL_NOT_REUSED**, classified within **ACCEPTANCE_RUNNER_INTEGRATION_FAILURE**. **KNOWN_ENTITY_SENT_TO_DISCOVERY** is secondary: the benchmark's operation “resolve this known company” was conflated with market discovery.

## Why the null company IDs were correct

Company discovery correctly separates uncertain identity from canonical attachment. In src/lib/company-discovery.ts, PROBABLE, AMBIGUOUS, and other non-auto-attach identities produce outcome `possible`, company `null`, and candidate report companyId `null`. Reuse within discovery is domain-first and requires exact-domain VERIFIED/VERIFIED_EXISTING COMPANY_PROFILE_RESOLUTION provenance or confirmed firmographics. Prior JYRA_DISCOVERY provenance alone is intentionally not trusted.

Thus the rank-1 candidates were not discovery-rejected. They were retained as NEEDS_REVIEW/possible, then blocked by runner provisioning because companyId was null. PROBABLE does **not** grant canonical auto-attachment. The ten “safe-to-research” findings rely on each target's independently verified pre-existing canonical project link, not on weakening attachment semantics.

## Per-control trace

| # | Input | Existing linked canonical ID | Canonical domain | Rank-1 identity | Raw | Reference | Discovery rejection | Runner |
|---:|---|---|---|---|---:|---|---|---|
| 1 | SolarWinds | 3cd73d96-37d1-4cf8-9dab-db596e019783 | solarwinds.com | PROBABLE | 10 | YES, rank 1 | NO; retained possible | NOT_PROVISIONED |
| 2 | First Horizon | 3ec654e3-3bed-405a-a1aa-1405f28ffcba | firsthorizon.com | PROBABLE | 10 | YES, rank 1 | NO; retained possible | NOT_PROVISIONED |
| 3 | GitLab | 417409dc-ca3f-449f-90bb-f315f91f450a | about.gitlab.com | AMBIGUOUS | 10 | YES, rank 1 | NO; retained possible | NOT_PROVISIONED |
| 4 | Infoblox | 408bc044-5be0-4118-b486-75c494e5cd8f | infoblox.com | PROBABLE | 10 | YES, rank 1 | NO; retained possible | NOT_PROVISIONED |
| 5 | Teradata | 0ba57746-1f8e-4691-a647-0921de1a971d | teradata.com | PROBABLE | 10 | YES, rank 1 | NO; retained possible | NOT_PROVISIONED |
| 6 | Nubank | 8ee8a9ce-dd62-4b03-bfb0-f9f9a3683f32 | nubank.com.br | PROBABLE | 10 | YES, rank 1 | NO; retained possible | NOT_PROVISIONED |
| 7 | Black Duck | fafc40de-2c9e-4968-bc3c-602d7d3f23c6 | blackduck.com | PROBABLE | 10 | YES, rank 1 | NO; retained possible | NOT_PROVISIONED |
| 8 | OpenAssets | 4944433c-43a4-41bb-b3f4-24fe98d56a8b | openassets.to | PROBABLE | 1 | YES, rank 1 | NO; retained possible | NOT_PROVISIONED |
| 9 | Black & McDonald | f757f1d3-fc2d-4086-8903-b4da90e166e3 | blackandmcdonald.com | PROBABLE | 9 | YES, rank 1 | NO; retained possible | NOT_PROVISIONED |
| 10 | RAKBANK | 94457ffa-bf97-426e-95b0-a1cf30250bd0 | rakbank.ae | PROBABLE | 10 | YES, rank 1 | NO; retained possible | NOT_PROVISIONED |

All stored LinkedIn values for the exact canonical records were null. Each exact record had JYRA_DISCOVERY provenance and linked_to_target_project=true. GitLab also had an unlinked duplicate, f685c762-98f6-41a3-a582-0e9d478909b0 at gitlab.com; that is a secondary data-quality issue, not the cause of the all-ten failure.

## Raw-result audit boundary

All ten persisted company_discovery_runs succeeded with one call each and no provider errors. Their raw counts were 10, 10, 10, 10, 10, 10, 10, 1, 9, and 10 (90 total). The official reference entity was rank 1 in identityCandidateReviews for every control: nine PROBABLE and GitLab AMBIGUOUS. Discovery rejected counts concern unrelated candidates only. Raw provider candidate payloads were not stored; fields unavailable from persisted identityCandidateReviews are explicitly NOT_AVAILABLE in the machine-readable artifacts.

Domain resolution data was already present in discovery results. Profile resolution, provider firmographics, and canonical attachment were not attempted for each rank-1 possible review; LinkedIn remained null.

## Regression and exclusion analysis

- **Normal identity regression: NO.** Provider-free test-company-profile-resolution.mjs passed regressions A–L. Provider-free test-company-identity.mjs passed 100-row normalization and regressions A–J. Company-likeness, CONFIRMED/PROBABLE semantics, service NOT_A_COMPANY, discovery-evidence reuse, wrong-profile, parent/brand, and attachment protections remain passing in fixtures.
- **Not provider failure.** Ten COMPANY_DISCOVERY calls succeeded, yielded 90 results, had no provider errors, and included all ten references at rank 1.
- **Not profile-resolution regression.** Profile resolution was not attempted for these rank-1 reviews, so it was not the failing stage.
- **Not company-likeness regression.** No rank-1 control was NOT_A_COMPANY, and fixture protections passed.
- **Not DB mismatch.** The approved development database, Aadit Technologies tenant, GTM-Q1 project, and approved Managed SOC pack were correct.

## Safety

Acceptance replay cutoff: 2026-09-01T09:29:50.819Z. New provider calls after cutoff: **0**. Production operations: **0**.
