# Phase 25A — Real-World Data Import Readiness

Validated on the approved development database only. No production database was accessed or modified.

## Automated verification

- OpenAPI generation: **PASS**
- Workspace typecheck: **PASS**
- API server production build: **PASS**
- Existing company identity regression suite: **PASS**
- Development database import fixture: **PASS**
- Concurrent identical commit fixture: **PASS**
- Cross-organization private-contact isolation fixture: **PASS**
- Mapping-semantic idempotency fixture: **PASS**
- 1,000-row preview: **PASS** (474–485 ms in the development fixture)
- Browser upload → mapping → preview → commit → company list: **PASS**

## Requirement matrix

| Requirement | Status | Evidence |
|---|---|---|
| Mixed company and contact rows | PASS | Browser and database fixtures import both entity types from one CSV. |
| Company-only rows | PASS | Domainless company fixture imports without a contact. |
| Multiple contacts for one company | PASS | Two contacts converge on one canonical company; database assertions verify both private contexts. |
| Flexible header mapping | PASS | Editable mapping table includes company, person, location, technology, custom, evidence, and ignore targets. |
| Unknown columns are never silently discarded | PASS | Unknown headers default to explicit custom-field storage; users may choose evidence-candidate or ignore. |
| Company/person field separation | PASS | Distinct company and person targets are exposed and persisted separately. |
| Company/person location separation | PASS | Database assertion verifies India/Bengaluru company location and Singapore person location remain separate. |
| Quoted CSV values and escaped quotes | PASS | State-machine parser handles quoted delimiters, line breaks, and escaped quote pairs. |
| Malformed row diagnostics | PASS | Row-width mismatch and unclosed-quote warnings are shown before preview. |
| Maximum 1,000 rows | PASS | UI and API enforce the limit; 1,000-row fixture passes. |
| Domain and URL normalization | PASS | `www`, scheme, path, case, and trailing slash normalize through the shared identity layer. |
| Missing-domain handling | PASS | Domainless companies receive `UNRESOLVED`, remain importable, and are reported after commit. |
| Invalid email/URL reporting | PASS | Invalid values appear at row level; invalid email is not persisted. |
| Name variations and aliases | PASS | Existing canonical company is matched by domain and imported name is stored as an alias. |
| Existing JYRA-discovered company convergence | PASS | Controlled discovery company and uploaded alias converge on one global canonical company. |
| Conservative ambiguous matching | PASS | Name-only possible matches are marked `NEEDS_REVIEW` and rejected from commit until corrected. |
| Repeat row/file idempotency | PASS | Immutable row fingerprints detect every row on a repeated upload; second commit creates no companies or contacts. |
| Concurrent import idempotency | PASS | Project and canonical-identity transaction locks ensure two identical simultaneous commits create one set of records. |
| Remapping corrections | PASS | Fingerprints include versioned mapping semantics, so a corrected mapping is processed rather than silently skipped. |
| Original value preservation | PASS | Original row, file label, normalized fields, and import fingerprint are retained in private provenance. |
| Unverified attributes do not become global truth | PASS | Revenue, funding, descriptions, technology, keywords, custom fields, and evidence candidates stay in scoped provenance. |
| Private contact persistence | PASS | Contacts are `PRIVATE`, organization-owned, project-scoped, and customer-provided. |
| Cross-organization contact isolation | PASS | The same uploaded LinkedIn identity in two organizations creates distinct private person records; the URL remains scoped provenance. |
| Invalid contact privacy | PASS | Invalid email is counted but never stored in project-person context. |
| Preview before commit | PASS | Commit requires explicit confirmation and the UI presents summary/review tabs first. |
| Detailed completion report | PASS | Results include company, duplicate, domain, contact, evidence, custom-field, and rejected-row totals. |
| No automatic enrichment or research | PASS | Import engine contains no provider dispatch; development fixture verifies research job count is unchanged. |
| Existing company-only endpoints remain compatible | PASS | Existing routes are unchanged and the company identity regression suite passes. |
| Phase 26 excluded | PASS | No Phase 26 functionality was added. |

## Development fixture coverage

The controlled fixture covers complete company/contact data, company-only data, missing domains, multiple contacts, company-name variations, URL normalization, missing optional financial/headcount values, invalid email, separate company/person locations, unknown columns, technology lists, duplicate rows, repeated uploads, ambiguous-name review behavior, and convergence with a JYRA-discovered company.

## Browser observations

- Mapping, preview, missing-domain review, completion report, and final Companies list were captured successfully.
- A non-blocking 403 request from an unrelated page access check and existing React Select controlled-state warnings were observed; neither affected the import flow.
- The browser fixture intentionally exposed a row-width parse warning; the warning was visible and the operator could still review the normalized row before import.