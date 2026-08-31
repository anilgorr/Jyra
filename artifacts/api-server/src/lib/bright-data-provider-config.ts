import { and, eq } from "drizzle-orm";
import { dataProvidersTable, db, providerCapabilitiesTable } from "@workspace/db";
import { BRIGHT_DATA_DATASET_ID } from "./bright-data-provider";

const BRIGHT_DATA_PROVIDER_CONFIGURATION = {
  apiBaseUrl: "https://api.brightdata.com",
  datasetId: BRIGHT_DATA_DATASET_ID,
  credentialEnv: "BRIGHTDATA_API_KEY",
  timeoutMs: 30_000,
  estimatedCost: 0.0015,
};

export async function ensureDevelopmentBrightDataProvider(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  const credentialStatus = process.env.BRIGHTDATA_API_KEY ? "AVAILABLE" : "MISSING";
  const configuration = {
    ...BRIGHT_DATA_PROVIDER_CONFIGURATION,
    credentialStatus,
  };
  await db.transaction(async (tx) => {
    await tx.insert(dataProvidersTable).values({
      name: "Bright Data",
      providerType: "bright_data",
      enabled: true,
      priority: 10,
      estimatedCost: configuration.estimatedCost,
      successRate: 0,
      averageLatency: 0,
      qualityScore: 0.85,
      configuration,
    }).onConflictDoNothing({ target: dataProvidersTable.name });

    const [provider] = await tx.select().from(dataProvidersTable)
      .where(and(
        eq(dataProvidersTable.name, "Bright Data"),
        eq(dataProvidersTable.providerType, "bright_data"),
      ))
      .limit(1);
    if (!provider) return;

    await tx.update(dataProvidersTable).set({
      enabled: true,
      priority: 10,
      estimatedCost: configuration.estimatedCost,
      qualityScore: 0.85,
      configuration: {
        ...provider.configuration,
        ...configuration,
      },
      updatedAt: new Date(),
    }).where(eq(dataProvidersTable.id, provider.id));

    await tx.insert(providerCapabilitiesTable).values({
      providerId: provider.id,
      capability: "COMPANY_FIRMOGRAPHICS",
    }).onConflictDoNothing({
      target: [providerCapabilitiesTable.providerId, providerCapabilitiesTable.capability],
    });
  });
}