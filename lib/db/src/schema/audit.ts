import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

/**
 * Audit log of every mutating API call (and authn/security events).
 *
 * Writes happen synchronously after the route succeeds so the entry
 * captures the real outcome. The reader UI, exports, and retention
 * policy belong to the audit-explorer task; this table is just the
 * write surface so RBAC enforcement can record actor, action,
 * resource, and result.
 */
export const auditLogTable = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "set null" }),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    result: text("result").notNull(),
    requestId: text("request_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOrgCreatedAt: index("audit_log_org_created_at_idx").on(t.organizationId, t.createdAt),
    byActor: index("audit_log_actor_idx").on(t.actorUserId, t.createdAt),
    byAction: index("audit_log_action_idx").on(t.action, t.createdAt),
  }),
);

export type AuditLog = typeof auditLogTable.$inferSelect;
export type InsertAuditLog = typeof auditLogTable.$inferInsert;
