import { and, eq } from "drizzle-orm";
import { dataProvidersTable, db, providerCapabilitiesTable } from "@workspace/db";

/**
 * Exa is a search fallback, and priced like one: USD 0.019 a query against
 * Serper's 0.001. It used to be seeded at priority 5, tying Serper and
 * winning or losing the tie on cost alone; 15 says what is meant — after
 * Serper (5) and after Tavily (10), reached only when both are unavailable.
 */
const EXA_PRIORITY = 15;

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
      priority: EXA_PRIORITY,
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
      priority: EXA_PRIORITY,
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