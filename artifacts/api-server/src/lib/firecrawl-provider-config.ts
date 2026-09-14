import { and, eq } from "drizzle-orm";
import { dataProvidersTable, db, providerCapabilitiesTable } from "@workspace/db";

/**
 * Firecrawl reads first-party pages for the research pass (WEBSITE_CRAWL)
 * and, from phase 3, the change gate. Priority 5 puts it ahead of Apify's
 * crawl actor. Priced at one credit per page on the $83 / 100k plan.
 */
const FIRECRAWL_PROVIDER_CONFIGURATION = {
  apiBaseUrl: "https://api.firecrawl.dev",
  credentialEnv: "FIRECRAWL_API_KEY",
  timeoutMs: 30_000,
  estimatedCost: 0.00083,
  crawlPaths: ["/about", "/about-us", "/careers", "/jobs"],
  routingRole: "PRIMARY",
};

export async function ensureDevelopmentFirecrawlProvider(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  const credentialStatus = process.env.FIRECRAWL_API_KEY ? "AVAILABLE" : "MISSING";
  await db.transaction(async (tx) => {
    await tx.insert(dataProvidersTable).values({
      name: "Firecrawl",
      providerType: "firecrawl",
      enabled: true,
      priority: 5,
      estimatedCost: FIRECRAWL_PROVIDER_CONFIGURATION.estimatedCost,
      successRate: 0,
      averageLatency: 0,
      qualityScore: 0.9,
      configuration: { ...FIRECRAWL_PROVIDER_CONFIGURATION, credentialStatus },
    }).onConflictDoNothing({ target: dataProvidersTable.name });

    const [provider] = await tx.select().from(dataProvidersTable)
      .where(and(eq(dataProvidersTable.name, "Firecrawl"), eq(dataProvidersTable.providerType, "firecrawl")))
      .limit(1);
    if (!provider) return;

    await tx.update(dataProvidersTable).set({
      enabled: true,
      priority: 5,
      estimatedCost: FIRECRAWL_PROVIDER_CONFIGURATION.estimatedCost,
      qualityScore: 0.9,
      configuration: { ...provider.configuration, ...FIRECRAWL_PROVIDER_CONFIGURATION, credentialStatus },
      updatedAt: new Date(),
    }).where(eq(dataProvidersTable.id, provider.id));

    await tx.insert(providerCapabilitiesTable).values({ providerId: provider.id, capability: "WEBSITE_CRAWL" })
      .onConflictDoNothing({ target: [providerCapabilitiesTable.providerId, providerCapabilitiesTable.capability] });

    // Apify's crawl actor is the only other WEBSITE_CRAWL route, it costs
    // USD 0.02 a company against Firecrawl's 0.004, and it has been failing
    // while still billing for the attempt. With a Firecrawl key present there
    // is nothing for it to fall back to usefully, so switch it off rather
    // than leave it one provider error away from being paid to fail. Its row,
    // actor configuration and credentials are untouched: clearing the
    // Firecrawl key turns it back on at the next boot.
    if (credentialStatus === "AVAILABLE") {
      const [apify] = await tx.select().from(dataProvidersTable)
        .where(eq(dataProvidersTable.providerType, "apify")).limit(1);
      if (apify?.enabled) {
        await tx.update(dataProvidersTable).set({
          enabled: false,
          priority: Math.max(apify.priority, 40),
          configuration: { ...apify.configuration, routingRole: "FALLBACK", disabledReason: "SUPERSEDED_BY_FIRECRAWL" },
          updatedAt: new Date(),
        }).where(eq(dataProvidersTable.id, apify.id));
      }
    }
  });
}
