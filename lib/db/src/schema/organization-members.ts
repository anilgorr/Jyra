import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

export const organizationRoleEnum = pgEnum("organization_role", [
  "owner",
  "admin",
  "member",
]);

export const organizationMembersTable = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: organizationRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("organization_members_org_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    index("organization_members_user_id_idx").on(table.userId),
    index("organization_members_organization_id_idx").on(table.organizationId),
  ],
);

export const insertOrganizationMemberSchema = createInsertSchema(
  organizationMembersTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrganizationMember = z.infer<
  typeof insertOrganizationMemberSchema
>;
export type OrganizationMember =
  typeof organizationMembersTable.$inferSelect;