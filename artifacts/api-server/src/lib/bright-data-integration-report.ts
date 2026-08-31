import { and, count, eq, sql } from "drizzle-orm";
import { db, providerUsageTable } from "@workspace/db";

export async function countControlledBrightDataCalls(providerId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(providerUsageTable)
    .where(and(
      eq(providerUsageTable.providerId, providerId),
      eq(providerUsageTable.capability, "COMPANY_FIRMOGRAPHICS"),
      sql`${providerUsageTable.metadata} ->> 'test' = 'BRIGHT_DATA_INTEGRATION_TEST'`,
    ));
  return Number(row?.value ?? 0);
}