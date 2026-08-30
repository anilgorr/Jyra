# JYRA — HOTFIX 04

## Final status

**PASS**

The 7C Studio crawl did not return zero evidence. The provider returned usable content and JYRA persisted it correctly. The user-facing zero-evidence warning was caused by a frontend/API status mismatch.

## Required diagnostic output

- Provider selected: Apify
- Capability: `WEBSITE_CRAWL`
- Requested company domain: `7cstudio.com`
- Normalized crawl URL after fix: `https://7cstudio.com`
- Canonical domain remains: `7cstudio.com`
- Adapter: configured Apify Website Content Crawler adapter
- Provider status: success
- Research job status: `SUCCEEDED`
- Provider result items: 1
- URLs returned: 1
- Pages with non-empty text: 1
- Raw evidence candidates: 1
- Extraction candidates: 0
- Extraction candidates rejected: 0
- Deduplicated on the successful persistence run: 0
- Persisted as RAW evidence: 1
- Actual provider cost: $0.010844416

## Returned source

- Source URL: `http://7cstudio.com`
- Evidence status: `RAW`
- Content: non-empty public company description, services, technology expertise, founder attribution, and location information

The provider's returned source URL is retained as observed provenance. Future crawl requests use the normalized HTTPS official URL.

## Exact zero stage

No backend stage became zero during the successful crawl:

1. Planner requested `WEBSITE_CRAWL`.
2. Provider Router selected Apify.
3. Apify returned one dataset item.
4. The item contained non-empty text.
5. The item produced one raw evidence candidate.
6. Deduplication found no existing matching evidence at that time.
7. One RAW evidence record was persisted.

The incorrect zero appeared only in frontend presentation. The UI compared `resultStatus.toLowerCase()` with `"success"`, but the research API returns the persisted job status `"SUCCEEDED"`. Therefore a genuinely successful result entered the warning branch and displayed:

> Fresh research attempted. The sweep completed without new evidence.

## Fix applied

1. The Company Intelligence research panel now treats `SUCCEEDED` as success.
2. Successful runs with new evidence report the number added.
3. Successful runs whose content is already present report that usable pages were returned but already captured.
4. Successful runs with no usable content report that distinction explicitly.
5. Website crawl requests now normalize the canonical company domain to an HTTPS official URL.
6. The Apify adapter now recognizes `loadedUrl` in addition to `url`.
7. Provider metadata now records:
   - raw result count
   - returned URL count
   - non-empty content page count

## Rejection reasons

None for the successful 7C Studio run.

The fact extractor returned no candidates, but fact extraction is downstream of RAW evidence persistence and did not prevent the source content from being stored.

## Deduplication

Deduplication is based on company, normalized source URL, and normalized content hash. Failed provider attempts create no crawl-page or evidence fingerprint.

If the same unchanged page is fetched again, zero **new** evidence records is correct. The UI now describes that as already-captured content rather than implying that the provider returned nothing.

## Database safety

- Development only
- Production untouched
- No schema migration
- No manual evidence insertion
- No fake provider or mock evidence
- No company other than 7C Studio tested
- No capability other than `WEBSITE_CRAWL` tested
- No scoring, signal, or opportunity-state logic changed