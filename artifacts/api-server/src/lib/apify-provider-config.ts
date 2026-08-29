import { dataProvidersTable, db } from "@workspace/db";

export async function ensureApifyProviderPlaceholder(): Promise<void> {
  await db
    .insert(dataProvidersTable)
    .values({
      name: "Apify",
      providerType: "apify",
      enabled: false,
      priority: 100,
      estimatedCost: 0,
      successRate: 0,
      averageLatency: 0,
      qualityScore: 0,
      configuration: {
        connector: "apify",
        actorIds: {},
      },
    })
    .onConflictDoNothing({ target: dataProvidersTable.name });
}