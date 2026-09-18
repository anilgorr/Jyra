import { and, eq } from "drizzle-orm";
import { dataProvidersTable, db } from "@workspace/db";

/**
 * Bright Data is retired.
 *
 * The firmographics adapter answered 266 of 266 calls between 14 and 18
 * September 2026 with IDENTIFIER_NOT_SUPPORTED, and not one successful
 * response in its entire life. That is not an expired credential or a rate
 * limit: the adapter asks the dataset for a company by an identifier the
 * dataset does not accept, so every cycle paid the latency of a request that
 * could never succeed. With no INDUSTRY or EMPLOYEE_SIZE claim reaching the
 * model, Fit was unknown for 26 of the first 99 companies assessed.
 *
 * What it was supposed to supply now comes from the LinkedIn company snippet
 * the search step already returns (`profile-snippet-facts.ts`), free and
 * deterministically. So the row is disabled at boot in every environment
 * rather than seeded, and the router no longer knows how to build the
 * adapter. The COMPANY_FIRMOGRAPHICS capability itself stays in the research
 * waterfall: the step simply finds no provider and moves on, and a working
 * vendor can be registered against it later without reopening the waterfall.
 *
 * Disabling rather than deleting the row keeps its spend history joinable.
 */
export async function retireBrightDataProvider(): Promise<void> {
  await db.update(dataProvidersTable)
    .set({ enabled: false, updatedAt: new Date() })
    .where(and(
      eq(dataProvidersTable.providerType, "bright_data"),
      eq(dataProvidersTable.enabled, true),
    ));
}
