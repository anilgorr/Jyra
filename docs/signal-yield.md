# Why 447 facts produced four signals

Measured against the live database on 2026-09-14, before any of this was
fixed. The numbers matter more than the conclusions, because the conclusions
change and the numbers are what you re-measure against.

| | |
|---|---|
| Facts stored | 447 |
| Facts that survive the evidence-acceptance join | 447 |
| Fact types present | one — `JOB_OPENING` |
| Companies producing facts | 11, of 73 watched |
| Signals, all time | 4 |
| Signals the stored facts had already earned | 7 |
| Companies with an active signal | 3 |

Three separate things are going on, and they are usually confused with each
other.

## 1. Evaluation was coupled to crawling

Signal detection only ever ran as the tail of a paid research cycle. A cycle
only runs when the change gate sees a page move. So facts already on disk were
never re-tested against the rules as they stand now.

Datadog's thirteen open marketing roles landed at 15:39. The
`digital-marketing` pack was switched on for that project at 16:54. Nothing
connected the two, and six days later there was still no marketing signal.
Same for LaunchDarkly (`MSOC_SECURITY_HIRING`, two supporting facts) and
KALKI (`MARKETING_TEAM_GROWTH`, one).

Fixed: `lib/signal-reevaluation.ts`. A company is re-evaluated when a fact
arrived or a pack was reconfigured since `project_companies.signals_evaluated_at`.
It costs nothing but database round trips, so it runs at the top of every watch
tick — before the paid sweep, so a signal it creates makes the company HOT for
the rest of that tick — and again whenever a pack's configuration changes.

## 2. The ceiling is companies × definitions, not facts

`mode: "single"` collapses every matching fact for a company into one signal.
Datadog's thirty-one security roles are one `MSOC_SECURITY_HIRING` signal, not
thirty-one. So 447 facts across 11 companies with two reachable definitions
can produce at most about twenty signals, ever.

Counting facts is the wrong yardstick. **Companies carrying an active signal**
is the number that maps to what the customer buys, and it was 3 of 73.

## 3. Thirty-eight of forty definitions are unreachable

The catalogue asks for `LEADERSHIP_CHANGE`, `FUNDING_EVENT`,
`TECHNOLOGY_MENTION`, `CERTIFICATION`, `COMPLIANCE_MENTION`,
`SECURITY_INCIDENT`, `COMPANY_EXPANSION`, `HIRING_COUNT`. None of those fact
types exist in the database. The event pass has never produced a fact, so only
the two `JOB_OPENING` definitions on the active packs can fire at all — and
they still have to match on keywords, which 49 of the 447 facts do.

Two consequences worth holding onto:

- The event pass is not just a missing feature, it is most of the catalogue.
  Fixing it is worth more than any amount of tuning on the hiring definitions.
- `SECURITY_HIRING_ACCELERATION` is the strongest definition in the catalogue
  (strength 88) and needs `HIRING_COUNT` facts, which nothing writes. The
  change gate is already recording an ATS job count per company on every check
  — 13 companies had one within a day of the gate going live. Turning those
  free observations into `HIRING_COUNT` facts costs nothing and unlocks the
  highest-value rule there is. It needs two observations apart in time, so the
  sooner it starts recording, the sooner it pays.

## crawl_pages is append-only

A database trigger raises `crawl_pages records are append-only` on every UPDATE
and DELETE of that table. That invariant is right: what a source said at the
moment it was read is what every fact is validated against, and it must not be
rewritable afterwards.

Two consequences that cost a deploy to learn:

- Processing state about a page cannot live on the page's row. The
  "which extractor has read this" marker is its own table,
  `crawl_page_extractions`. The first attempt put two columns on `crawl_pages`,
  the trigger silently refused every write, and the sweep re-read the same
  pages on every tick while reporting them as failures.
- `ON CONFLICT DO UPDATE` on `crawl_pages` does not survive a collision. Three
  writers used it to get past the unique index on (company, url, content hash)
  after one collision killed a paid cycle. It converts a unique violation into
  a trigger exception at exactly the same moment and kills the cycle the same
  way — it only looked fixed because a genuine collision is rare. Everything
  now goes through `claimCrawlPage`, which inserts and, on conflict, reads the
  existing row back.

## How to re-measure

```sql
-- signals the stored facts have earned, vs. the signals that exist
with defs as (
  select psp.project_id, sd.code, sd.minimum_confidence,
         array(select jsonb_array_elements_text(sd.configuration->'factTypes')) as fact_types,
         array(select replace(jsonb_array_elements_text(sd.configuration->'matchAny'),'\b','\y')) as match_any
  from project_signal_packs psp
  join signal_packs sp on sp.id=psp.signal_pack_id and sp.active and sp.status='APPROVED'
  join signal_definitions sd on sd.signal_pack_id=sp.id and sd.status='APPROVED'
  where psp.active and coalesce(sd.configuration->>'mode','single')='single'
)
select p.name, d.code, c.canonical_name, count(*) as supporting_facts,
       (select count(*) from signals s join signal_definitions x on x.id=s.signal_definition_id
        where s.project_id=d.project_id and s.company_id=pc.company_id and x.code=d.code) as exists
from defs d
join project_companies pc on pc.project_id=d.project_id
 and pc.buyer_role::text not in ('SELLER_COMPETITOR','ADJACENT_VENDOR')
join company_facts cf on cf.company_id=pc.company_id
join projects p on p.id=d.project_id
join companies c on c.id=pc.company_id
where cf.fact_type::text = any(d.fact_types)
  and cf.confidence >= d.minimum_confidence
  and (cardinality(d.match_any)=0 or exists (
        select 1 from unnest(d.match_any) m
        where lower(cf.supporting_excerpt || ' ' || cf.structured_value::text) ~* m))
group by 1,2,3,d.project_id,pc.company_id,d.code
order by exists, count(*) desc;
```

A row with `exists = 0` is a signal the customer has paid for and is not
seeing. After the re-evaluation sweep runs, there should be none.
