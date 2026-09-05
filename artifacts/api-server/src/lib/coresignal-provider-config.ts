import { and, eq } from "drizzle-orm";
import { dataProvidersTable, db, providerCapabilitiesTable } from "@workspace/db";

const CORESIGNAL_PROVIDER_CONFIGURATION = {
  apiBaseUrl: "https://api.coresignal.com/cdapi/v2",
  credentialEnv: "CORESIGNAL_API_KEY",
  timeoutMs: 25_000,
  estimatedCost: 0.02,
  maxCandidates: 1,
};

/** Seeds the Coresignal contact provider (EMAIL_LOOKUP) for local development.
 * Idempotent: safe to run on every boot. The provider is enabled only when a
 * credential is present, so the enrichment waterfall stays fail-closed until a
 * key is configured. */
export async function ensureDevelopmentCoresignalProvider(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  const hasCredential = Boolean(process.env.CORESIGNAL_API_KEY);
  const configuration = {
    ...CORESIGNAL_PROVIDER_CONFIGURATION,
    credentialStatus: hasCredential ? "AVAILABLE" : "MISSING",
  };
  await db.transaction(async (tx) => {
    await tx.insert(dataProvidersTable).values({
      name: "Coresignal",
      providerType: "coresignal",
      enabled: hasCredential,
      priority: 10,
      estimatedCost: configuration.estimatedCost,
      successRate: 0,
      averageLatency: 0,
      qualityScore: 0.9,
      configuration,
    }).onConflictDoNothing({ target: dataProvidersTable.name });

    const [provider] = await tx.select().from(dataProvidersTable)
      .where(and(
        eq(dataProvidersTable.name, "Coresignal"),
        eq(dataProvidersTable.providerType, "coresignal"),
      ))
      .limit(1);
    if (!provider) return;

    await tx.update(dataProvidersTable).set({
      enabled: hasCredential,
      priority: 10,
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
