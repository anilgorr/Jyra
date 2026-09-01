/** Pure Fix 11 policy seams: no provider, database, or model dependency. */
export function minimumIntelligenceSufficient(input: {
  description?: string | null; industry?: string | null; products?: string[]; evidenceTexts?: string[];
}): boolean {
  const usable = (value: unknown) => typeof value === "string" && value.replace(/\s+/g, " ").trim().length >= 12;
  return usable(input.description) || usable(input.industry) ||
    (input.products ?? []).some(usable) || (input.evidenceTexts ?? []).some(usable);
}
export function shouldCallMinimumIntelligenceProvider(input: { cacheHit: boolean; identitySafe: boolean; sufficient: boolean }): boolean {
  return !input.cacheHit && input.identitySafe && !input.sufficient;
}
export function boundedProfileResolutionCalls(primaryAttempted: boolean, fallbackAttempted: boolean): number {
  return Number(primaryAttempted) + Number(fallbackAttempted);
}
export function researchStopCode(role: string, identitySafe = true): string | null {
  if (!identitySafe) return "UNSAFE_IDENTITY";
  if (role === "UNKNOWN") return "STILL_UNKNOWN";
  return role === "POTENTIAL_BUYER" ? null : "NON_BUYER";
}