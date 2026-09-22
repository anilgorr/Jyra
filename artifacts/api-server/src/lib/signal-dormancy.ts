import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * Why a signal definition has produced nothing.
 *
 * A definition that never fires looks identical from the outside to a market
 * that is quiet, and the difference is the whole question. Three of the packs'
 * definitions were keyed to CERTIFICATION and nine to COMPANY_EXPANSION and
 * NEW_MARKET, and none of those fact types had ever produced a row - not
 * because companies were not certifying or expanding, but because nothing
 * extracted them and no query asked. That state was invisible: it took an
 * afternoon of hand-written SQL to establish, and several plausible theories
 * died on the way.
 *
 * So each definition reports which of three states it is in, and DARK is not
 * a reason to delete a definition. It is the roadmap.
 */
export type DormancyState = "FIRING" | "ARMED" | "DARK";

export type DormancyVerdict = {
  state: DormancyState;
  reason: string;
};

/**
 * Classify one definition from three counts. Pure, so the rule is testable
 * without a database.
 *
 * FIRING means it has produced signals. ARMED means its fact type exists
 * somewhere in the system but this definition has matched nothing - a real
 * market answer, or a filter too narrow, but the plumbing is proven. DARK
 * means no fact of any of its types has ever been produced by any source,
 * which is a statement about the pipeline and never about the market.
 */
export function classifyDormancy(input: {
  code: string;
  factTypes: string[];
  signalsProduced: number;
  factsInProject: number;
  factsAnywhere: number;
}): DormancyVerdict {
  const types = input.factTypes.length ? input.factTypes.join(", ") : "(none declared)";
  if (input.signalsProduced > 0) {
    return { state: "FIRING", reason: `${input.signalsProduced} signal(s) from ${input.factsInProject} fact(s)` };
  }
  if (!input.factTypes.length) {
    return { state: "DARK", reason: "declares no fact type, so nothing can ever match it" };
  }
  if (input.factsAnywhere === 0) {
    return { state: "DARK", reason: `no ${types} fact has ever been produced by any source` };
  }
  if (input.factsInProject === 0) {
    return { state: "ARMED", reason: `${input.factsAnywhere} ${types} fact(s) exist, none on this project's companies` };
  }
  return { state: "ARMED", reason: `${input.factsInProject} ${types} fact(s) on this project, none matched the definition` };
}

export type DormancyRow = DormancyVerdict & {
  code: string;
  name: string;
  category: string;
  factTypes: string[];
  signalsProduced: number;
  factsInProject: number;
  factsAnywhere: number;
};

/**
 * The dormancy of every definition on a project's packs.
 *
 * The counts are deliberately split between this project and everywhere: a
 * definition with no facts here but plenty elsewhere is a coverage problem on
 * this pool, while one with none anywhere is a missing extractor or a missing
 * query, and those are answered by different work.
 */
export async function reportSignalDormancy(projectId: string): Promise<DormancyRow[]> {
  const result = await db.execute(sql`
    with definitions as (
      select sd.id, sd.code, sd.name, sd.category, sd.fact_requirements
      from signal_definitions sd
      join project_signal_packs psp on psp.signal_pack_id = sd.signal_pack_id
      where psp.project_id = ${projectId}
    ),
    typed as (
      select d.id, d.code, d.name, d.category,
             coalesce(array_agg(ft.value #>> '{}') filter (where ft.value is not null), '{}') as fact_types
      from definitions d
      left join lateral jsonb_array_elements(
        case when jsonb_typeof(d.fact_requirements) = 'array' then d.fact_requirements
             else coalesce(d.fact_requirements -> 'factTypes', '[]'::jsonb) end) as ft(value) on true
      group by d.id, d.code, d.name, d.category
    ),
    pool as (
      select company_id from project_companies where project_id = ${projectId}
    )
    select t.code, t.name, t.category, t.fact_types,
           (select count(*) from signals s where s.signal_definition_id = t.id)          as signals_produced,
           (select count(*) from company_facts cf join pool p on p.company_id = cf.company_id
              where cf.fact_type::text = any(t.fact_types))                              as facts_in_project,
           (select count(*) from company_facts cf
              where cf.fact_type::text = any(t.fact_types))                              as facts_anywhere
    from typed t
    order by signals_produced desc, facts_in_project desc, t.code
  `);

  return (result.rows as Array<Record<string, unknown>>).map((row) => {
    const factTypes = Array.isArray(row.fact_types) ? (row.fact_types as string[]) : [];
    const counts = {
      code: String(row.code),
      factTypes,
      signalsProduced: Number(row.signals_produced ?? 0),
      factsInProject: Number(row.facts_in_project ?? 0),
      factsAnywhere: Number(row.facts_anywhere ?? 0),
    };
    return {
      ...counts,
      name: String(row.name ?? ""),
      category: String(row.category ?? ""),
      ...classifyDormancy(counts),
    };
  });
}

/** The go-live gate: how many definitions are dark, and which. */
export function summariseDormancy(rows: DormancyRow[]): {
  firing: number; armed: number; dark: number; darkCodes: string[];
} {
  return {
    firing: rows.filter((row) => row.state === "FIRING").length,
    armed: rows.filter((row) => row.state === "ARMED").length,
    dark: rows.filter((row) => row.state === "DARK").length,
    darkCodes: rows.filter((row) => row.state === "DARK").map((row) => row.code),
  };
}
