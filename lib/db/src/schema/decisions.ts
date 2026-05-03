import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { policiesTable } from "./policies";
import { ruleOutcomeEnum } from "./rules";

export const decisionsTable = pgTable("decisions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "set null" }),
  policyId: integer("policy_id").references(() => policiesTable.id, { onDelete: "set null" }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  contextJson: jsonb("context_json").notNull().default({}),
  outcome: ruleOutcomeEnum("outcome").notNull(),
  rulesAppliedJson: jsonb("rules_applied_json").notNull().default([]),
  explanation: text("explanation"),
  confidence: integer("confidence").notNull().default(100),
  scenario: text("scenario"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDecisionSchema = createInsertSchema(decisionsTable).omit({ id: true, createdAt: true });
export type InsertDecision = z.infer<typeof insertDecisionSchema>;
export type Decision = typeof decisionsTable.$inferSelect;
