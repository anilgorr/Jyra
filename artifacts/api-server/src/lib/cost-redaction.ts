/**
 * Real-money cost is for internal admins only.
 *
 * 16 Sep 2026 moved the Plan page to credits and put rupee cost on the admin
 * panel. Other screens kept showing dollars: a run's cost on the company page,
 * spend on What changed, a research economics card with budgets, the cost of
 * a contact lookup. 26 Sep 2026: every customer-facing response now drops
 * those fields unless the viewer is an internal admin, so the number is not
 * merely hidden by the UI but absent from the network response.
 *
 * Pure functions, no imports: the route decides who is looking, these decide
 * what they get.
 */

/** Removes the run's `cost` block. */
export function redactRunCost<T extends object>(run: T, seesCost: boolean): T {
  if (seesCost || !("cost" in run)) return run;
  const { cost: _cost, ...rest } = run as T & { cost?: unknown };
  return rest as T;
}

type ChangeFeedLike = {
  items: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
};

/** Removes per-change `costTotal` and the window's `spendUsd`. */
export function redactChangeFeedCost<T extends ChangeFeedLike>(feed: T, seesCost: boolean): T {
  if (seesCost) return feed;
  const { spendUsd: _spend, ...summary } = feed.summary;
  return {
    ...feed,
    items: feed.items.map(({ costTotal: _cost, ...item }) => item),
    summary,
  };
}

type PersonLike = { attempts: Array<Record<string, unknown>> };

/** Removes `estimatedCost` / `actualCost` from each contact-lookup attempt. */
export function redactPeopleCost<T extends PersonLike>(people: T[], seesCost: boolean): T[] {
  if (seesCost) return people;
  return people.map((person) => ({
    ...person,
    attempts: person.attempts.map(({ estimatedCost: _e, actualCost: _a, ...attempt }) => attempt),
  }));
}

/** Removes `cost` from each capability result of a contact enrichment. */
export function redactEnrichmentCost<T extends { results?: Array<Record<string, unknown>> }>(result: T, seesCost: boolean): T {
  if (seesCost || !Array.isArray(result.results)) return result;
  return { ...result, results: result.results.map(({ cost: _cost, ...rest }) => rest) };
}
