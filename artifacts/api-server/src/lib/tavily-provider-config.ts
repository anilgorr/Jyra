import { and, eq } from "drizzle-orm";
import { dataProvidersTable, db, providerCapabilitiesTable } from "@workspace/db";

const TAVILY_PROVIDER_CONFIGURATION = {
  apiBaseUrl: "https://api.tavily.com",
  credentialEnv: "TAVILY_API_KEY",
  timeoutMs: 20_000,
  estimatedCost: 0.01,
  routingRole: "PRIMARY",
};

export async function ensureDevelopmentTavilyProvider(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  const credentialStatus = process.env.TAVILY_API_KEY ? "AVAILABLE" : "MISSING";
  await db.transaction(async (tx) => {
    await tx.insert(dataProvidersTable).values({
      name: "Tavily",
      providerType: "tavily",
      enabled: true,
      priority: 10,
      estimatedCost: TAVILY_PROVIDER_CONFIGURATION.estimatedCost,
      successRate: 0,
      averageLatency: 0,
      qualityScore: 0.9,
      configuration: {
        ...TAVILY_PROVIDER_CONFIGURATION,
        credentialStatus,
      },
    }).onConflictDoNothing({ target: dataProvidersTable.name });

    const [provider] = await tx.select().from(dataProvidersTable)
      .where(and(eq(dataProvidersTable.name, "Tavily"), eq(dataProvidersTable.providerType, "tavily")))
      .limit(1);
    if (!provider) return;

    await tx.update(dataProvidersTable).set({
      enabled: true,
      priority: 10,
      estimatedCost: TAVILY_PROVIDER_CONFIGURATION.estimatedCost,
      qualityScore: 0.9,
      configuration: {
        ...provider.configuration,
        ...TAVILY_PROVIDER_CONFIGURATION,
        credentialStatus,
      },
      updatedAt: new Date(),
    }).where(eq(dataProvidersTable.id, provider.id));

    await tx.insert(providerCapabilitiesTable).values({
      providerId: provider.id,
      capability: "WEB_SEARCH",
    }).onConflictDoNothing({
      target: [providerCapabilitiesTable.providerId, providerCapabilitiesTable.capability],
    });
  });
}