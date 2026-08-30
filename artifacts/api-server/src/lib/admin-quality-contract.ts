export type AdminWindow = { from: Date; to: Date; days: number };

export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

export function windowInput(days: number | undefined, now = new Date()): AdminWindow {
  const boundedDays = Math.min(90, Math.max(1, Math.trunc(days ?? 30)));
  const from = new Date(now.getTime() - boundedDays * 24 * 60 * 60 * 1000);
  return { from, to: now, days: boundedDays };
}

const forbiddenPrivateKeys = /^(organization|project|company|contact|recommendation|evidence|source)(Id|Ids|Url|Text|Excerpt|Payload|Copy|Name|Domain)$/i;

export function assertAggregateOnly(value: unknown, path = "response"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertAggregateOnly(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenPrivateKeys.test(key)) {
      throw new Error(`Private field is not permitted in admin aggregates: ${path}.${key}`);
    }
    assertAggregateOnly(child, `${path}.${key}`);
  }
}