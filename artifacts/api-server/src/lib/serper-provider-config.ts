import { and, eq } from "drizzle-orm";
import { dataProvidersTable, db, providerCapabilitiesTable } from "@workspace/db";

/**
 * Serper is the primary search vendor as of the 14 Sep 2026 bake-off. It
 * sits at priority 5, ahead of Tavily's 10, and is priced at its list rate so
 * the budget ceiling stops guessing. Tavily's row is demoted to FALLBACK in
 * the same pass so a waterfall still has somewhere to go.
 */
const SERPER_PROVIDER_CONFIGURATION = {
  apiBaseUrl: "https://google.serper.dev",
  credentialEnv: "SERPER_API_KEY",
  timeoutMs: 20_000,
  estimatedCost: 0.001,
  rawContentTop: 5,
  routingRole: "PRIMARY",
};

export async function ensureDevelopmentSerperProvider(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  const credentialStatus = process.env.SERPER_API_KEY ? "AVAILABLE" : "MISSING";
  await db.transaction(async (tx) => {
    await tx.insert(dataProvidersTable).values({
      name: "Serper",
      providerType: "serper",
      enabled: true,
      priority: 5,
      estimatedCost: SERPER_PROVIDER_CONFIGURATION.estimatedCost,
      successRate: 0,
      averageLatency: 0,
      qualityScore: 0.92,
      configuration: { ...SERPER_PROVIDER_CONFIGURATION, credentialStatus },
    }).onConflictDoNothing({ target: dataProvidersTable.name });

    const [provider] = await tx.select().from(dataProvidersTable)
      .where(and(eq(dataProvidersTable.name, "Serper"), eq(dataProvidersTable.providerType, "serper")))
      .limit(1);
    if (!provider) return;

    await tx.update(dataProvidersTable).set({
      enabled: true,
      priority: 5,
      estimatedCost: SERPER_PROVIDER_CONFIGURATION.estimatedCost,
      qualityScore: 0.92,
      configuration: { ...provider.configuration, ...SERPER_PROVIDER_CONFIGURATION, credentialStatus },
      updatedAt: new Date(),
    }).where(eq(dataProvidersTable.id, provider.id));

    for (const capability of ["WEB_SEARCH", "NEWS_SEARCH", "JOB_SEARCH"] as const) {
      await tx.insert(providerCapabilitiesTable).values({ providerId: provider.id, capability })
        .onConflictDoNothing({ target: [providerCapabilitiesTable.providerId, providerCapabilitiesTable.capability] });
    }

    // Tavily keeps its row and its key; it just stops being asked first.
    const [tavily] = await tx.select().from(dataProvidersTable)
      .where(eq(dataProvidersTable.providerType, "tavily")).limit(1);
    if (tavily && tavily.configuration.routingRole !== "FALLBACK") {
      await tx.update(dataProvidersTable).set({
        priority: Math.max(tavily.priority, 10),
        configuration: { ...tavily.configuration, routingRole: "FALLBACK" },
        updatedAt: new Date(),
      }).where(eq(dataProvidersTable.id, tavily.id));
    }
  });
}
