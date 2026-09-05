import { and, eq } from "drizzle-orm";
import { dataProvidersTable, db, providerCapabilitiesTable } from "@workspace/db";

const EXPLEE_PROVIDER_CONFIGURATION = {
  apiBaseUrl: "https://api.explee.com/public/api/v1",
  credentialEnv: "EXPLEE_API_KEY",
  timeoutMs: 100_000,
  estimatedCost: 0.05,
  preset: "basic" as const,
};

/** Seeds the Explee contact provider (EMAIL_LOOKUP) for local development.
 * Idempotent. Enabled only when EXPLEE_API_KEY is present, and given a higher
 * priority than other contact providers so it leads the enrichment waterfall. */
export async function ensureDevelopmentExpleeProvider(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  const hasCredential = Boolean(process.env.EXPLEE_API_KEY);
  const configuration = {
    ...EXPLEE_PROVIDER_CONFIGURATION,
    credentialStatus: hasCredential ? "AVAILABLE" : "MISSING",
  };
  await db.transaction(async (tx) => {
    await tx.insert(dataProvidersTable).values({
      name: "Explee",
      providerType: "explee",
      enabled: hasCredential,
      priority: 5,
      estimatedCost: configuration.estimatedCost,
      successRate: 0,
      averageLatency: 0,
      qualityScore: 0.9,
      configuration,
    }).onConflictDoNothing({ target: dataProvidersTable.name });

    const [provider] = await tx.select().from(dataProvidersTable)
      .where(and(
        eq(dataProvidersTable.name, "Explee"),
        eq(dataProvidersTable.providerType, "explee"),
      ))
      .limit(1);
    if (!provider) return;

    await tx.update(dataProvidersTable).set({
      enabled: hasCredential,
      priority: 5,
      estimatedCost: configuration.estimatedCost,
      qualityScore: 0.9,
      configuration: { ...provider.configuration, ...configuration },
      updatedAt: new Date(),
    }).where(eq(dataProvidersTable.id, provider.id));

    await tx.insert(providerCapabilitiesTable).values({
      providerId: provider.id,
      capability: "EMAIL_LOOKUP",
    }).onConflictDoNothing({
      target: [providerCapabilitiesTable.providerId, providerCapabilitiesTable.capability],
    });
  });
}
