import { pgTable, integer, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable, userRoleEnum } from "./users";
import { organizationsTable } from "./organizations";

export const userOrgRolesTable = pgTable(
  "user_org_roles",
  {
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.organizationId] })],
);

export const insertUserOrgRoleSchema = createInsertSchema(userOrgRolesTable).omit({ createdAt: true });
export type InsertUserOrgRole = z.infer<typeof insertUserOrgRoleSchema>;
export type UserOrgRole = typeof userOrgRolesTable.$inferSelect;
