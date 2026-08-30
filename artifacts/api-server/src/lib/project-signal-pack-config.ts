import { and, desc, eq } from "drizzle-orm";
import {
  businessTwinVersionsTable,
  db,
  icpVersionsTable,
  projectSignalPacksTable,
  projectsTable,
  signalPacksTable,
} from "@workspace/db";

export type ConfigureProjectSignalPackInput = {
  organizationId: string;
  projectId: string;
  signalPackId: string;
  active: boolean;
  offeringKey: string | null;
  offeringSnapshot: Record<string, unknown>;
  businessContextSnapshot: Record<string, unknown>;
  configuration: {
    disabledCodes?: string[];
    strengthOverrides?: Record<string, number>;
    minimumConfidenceOverrides?: Record<string, number>;
  };
};

export async function configureProjectSignalPack(
  input: ConfigureProjectSignalPackInput,
) {
  const [pack] = await db.select().from(signalPacksTable).where(and(
    eq(signalPacksTable.id, input.signalPackId),
    eq(signalPacksTable.status, "APPROVED"),
  )).limit(1);
  if (!pack) throw new Error("Approved signal pack not found");

  const [project] = await db.select({ organizationId: projectsTable.organizationId })
    .from(projectsTable)
    .where(eq(projectsTable.id, input.projectId))
    .limit(1);
  if (!project || project.organizationId !== input.organizationId) {
    throw new Error("Project not found");
  }

  const [businessTwinVersion] = await db.select({
    id: businessTwinVersionsTable.id,
    version: businessTwinVersionsTable.version,
    status: businessTwinVersionsTable.status,
  }).from(businessTwinVersionsTable)
    .where(eq(businessTwinVersionsTable.projectId, input.projectId))
    .orderBy(desc(businessTwinVersionsTable.version)).limit(1);
  const [icpVersion] = await db.select({
    id: icpVersionsTable.id,
    version: icpVersionsTable.version,
    mode: icpVersionsTable.icpMode,
    sourceBusinessTwinVersionId: icpVersionsTable.sourceBusinessTwinVersionId,
  }).from(icpVersionsTable)
    .where(eq(icpVersionsTable.projectId, input.projectId))
    .orderBy(desc(icpVersionsTable.version)).limit(1);
  const businessContextSnapshot = {
    ...input.businessContextSnapshot,
    businessTwinVersion: businessTwinVersion ?? null,
    icpVersion: icpVersion ?? null,
  };

  const [selection] = await db.insert(projectSignalPacksTable).values({
    organizationId: input.organizationId,
    projectId: input.projectId,
    signalPackId: pack.id,
    active: input.active,
    offeringKey: input.offeringKey,
    offeringSnapshot: input.offeringSnapshot,
    businessContextSnapshot,
    configuration: input.configuration,
  }).onConflictDoUpdate({
    target: [projectSignalPacksTable.projectId, projectSignalPacksTable.signalPackId],
    set: {
      active: input.active,
      offeringKey: input.offeringKey,
      offeringSnapshot: input.offeringSnapshot,
      businessContextSnapshot,
      configuration: input.configuration,
      updatedAt: new Date(),
    },
  }).returning();
  return { selection, pack };
}