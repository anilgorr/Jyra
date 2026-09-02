import { and, eq } from "drizzle-orm";
import { dataProvidersTable, db, providerCapabilitiesTable } from "@workspace/db";

export async function ensureDevelopmentExaProvider(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  const configuration = {
    sdk: "exa-js",
    timeoutMs: 30_000,
    searchType: "auto",
    category: "company",
    content: "none",
    routingRole: "FALLBACK",
    // The bounded request shape returned at most USD 0.017 in the live preflight.
    // Keep an 11.8% buffer while preserving the fixed USD 50 campaign ceiling.
    estimatedCost: 0.019,
    credentialStatus: process.env.EXA_API_KEY ? "AVAILABLE" : "MISSING",
  };

  await db.transaction(async (tx) => {
    await tx.insert(dataProvidersTable).values({
      name: "Exa",
      providerType: "exa",
      enabled: true,
      priority: 5,
      estimatedCost: configuration.estimatedCost,
      successRate: 0,
      averageLatency: 0,
      qualityScore: 0.9,
      configuration,
    }).onConflictDoNothing({ target: dataProvidersTable.name });

    const [provider] = await tx.select().from(dataProvidersTable)
      .where(and(eq(dataProvidersTable.name, "Exa"), eq(dataProvidersTable.providerType, "exa")))
      .limit(1);
    if (!provider) return;

    await tx.update(dataProvidersTable).set({
      enabled: true,
      priority: 5,
      estimatedCost: configuration.estimatedCost,
      qualityScore: 0.9,
      configuration: {
        ...provider.configuration,
        ...configuration,
      },
      updatedAt: new Date(),
    }).where(eq(dataProvidersTable.id, provider.id));

    await tx.insert(providerCapabilitiesTable).values({
      providerId: provider.id,
      capability: "COMPANY_DISCOVERY",
    }).onConflictDoNothing({
      target: [providerCapabilitiesTable.providerId, providerCapabilitiesTable.capability],
    });
    await tx.insert(providerCapabilitiesTable).values({
      providerId: provider.id,
      capability: "WEB_SEARCH",
    }).onConflictDoNothing({
      target: [providerCapabilitiesTable.providerId, providerCapabilitiesTable.capability],
    });
  });
}