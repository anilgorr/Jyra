import { and, eq } from "drizzle-orm";
import { dataProvidersTable, db, providerCapabilitiesTable } from "@workspace/db";

const DEVELOPMENT_WEBSITE_CRAWL_ACTOR = "apify~website-content-crawler";

export async function ensureDevelopmentApifyProvider(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(dataProvidersTable).values({
      name: "Apify",
      providerType: "apify",
      enabled: true,
      priority: 20,
      estimatedCost: 0.02,
      successRate: 0,
      averageLatency: 0,
      qualityScore: 0,
      configuration: {
        connector: "apify",
        actorIds: { WEBSITE_CRAWL: DEVELOPMENT_WEBSITE_CRAWL_ACTOR },
        actorInputs: {
          WEBSITE_CRAWL: {
            maxCrawlPages: 8,
            maxCrawlDepth: 1,
            crawlerType: "playwright:adaptive",
            saveMarkdown: false,
            saveHtml: false,
          },
        },
        timeoutMs: 120_000,
        pollIntervalMs: 1_000,
        maxRetries: 1,
        datasetPageSize: 8,
        maxDatasetItems: 8,
        estimatedCost: 0.02,
        credentialStatus: "AVAILABLE",
      },
    }).onConflictDoNothing({ target: dataProvidersTable.name });

    const [provider] = await tx.select().from(dataProvidersTable)
      .where(and(eq(dataProvidersTable.name, "Apify"), eq(dataProvidersTable.providerType, "apify")))
      .limit(1);
    if (!provider) return;

    const actorIds = provider.configuration.actorIds;
    const hasCrawlActor = Boolean(
      actorIds && typeof actorIds === "object" && !Array.isArray(actorIds)
      && typeof (actorIds as Record<string, unknown>).WEBSITE_CRAWL === "string",
    );
    const wasPlaceholder = !provider.enabled && !hasCrawlActor;
    if (wasPlaceholder) {
      await tx.update(dataProvidersTable).set({
        enabled: true,
        priority: 20,
        estimatedCost: 0.02,
        configuration: {
          ...provider.configuration,
          actorIds: { WEBSITE_CRAWL: DEVELOPMENT_WEBSITE_CRAWL_ACTOR },
          actorInputs: {
            WEBSITE_CRAWL: {
              maxCrawlPages: 8,
              maxCrawlDepth: 1,
              crawlerType: "playwright:adaptive",
              saveMarkdown: false,
              saveHtml: false,
            },
          },
          timeoutMs: 120_000,
          pollIntervalMs: 1_000,
          maxRetries: 1,
          datasetPageSize: 8,
          maxDatasetItems: 8,
          estimatedCost: 0.02,
          credentialStatus: "AVAILABLE",
        },
      }).where(eq(dataProvidersTable.id, provider.id));
    }

    await tx.insert(providerCapabilitiesTable).values({
      providerId: provider.id,
      capability: "WEBSITE_CRAWL",
    }).onConflictDoNothing({
      target: [
        providerCapabilitiesTable.providerId,
        providerCapabilitiesTable.capability,
      ],
    });
  });
}