import { and, eq } from "drizzle-orm";
import { dataProvidersTable, db, providerCapabilitiesTable } from "@workspace/db";

const EXA_PROVIDER_CONFIGURATION = {
  connector: "exa",
  timeoutMs: 30_000,
  searchType: "fast",
  estimatedCost: 0.007,
  credentialStatus: "AVAILABLE",
};

export async function ensureDevelopmentExaProvider(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  await db.transaction(async (tx) => {
    await tx.insert(dataProvidersTable).values({
      name: "Exa",
      providerType: "exa",
      enabled: true,
      priority: 5,
      estimatedCost: EXA_PROVIDER_CONFIGURATION.estimatedCost,
      successRate: 0,
      averageLatency: 0,
      qualityScore: 0.9,
      configuration: EXA_PROVIDER_CONFIGURATION,
    }).onConflictDoNothing({ target: dataProvidersTable.name });

    const [provider] = await tx.select().from(dataProvidersTable)
      .where(and(eq(dataProvidersTable.name, "Exa"), eq(dataProvidersTable.providerType, "exa")))
      .limit(1);
    if (!provider) return;

    await tx.update(dataProvidersTable).set({
      enabled: true,
      priority: 5,
      estimatedCost: EXA_PROVIDER_CONFIGURATION.estimatedCost,
      qualityScore: 0.9,
      configuration: {
        ...provider.configuration,
        ...EXA_PROVIDER_CONFIGURATION,
      },
      updatedAt: new Date(),
    }).where(eq(dataProvidersTable.id, provider.id));

    await tx.insert(providerCapabilitiesTable).values({
      providerId: provider.id,
      capability: "COMPANY_DISCOVERY",
    }).onConflictDoNothing({
      target: [providerCapabilitiesTable.providerId, providerCapabilitiesTable.capability],
    });
  });
}