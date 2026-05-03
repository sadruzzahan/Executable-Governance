import { pgTable, text, serial, timestamp, integer, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { policiesTable } from "./policies";

export const ruleOutcomeEnum = pgEnum("rule_outcome", ["approved", "denied", "escalated", "needs_review"]);
export const ruleStatusEnum = pgEnum("rule_status", ["draft", "published", "archived"]);

export const rulesTable = pgTable("rules", {
  id: serial("id").primaryKey(),
  policyId: integer("policy_id").notNull().references(() => policiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  naturalLanguageText: text("natural_language_text").notNull(),
  structuredRepresentation: jsonb("structured_representation"),
  outcome: ruleOutcomeEnum("outcome").notNull(),
  priority: integer("priority").notNull().default(0),
  status: ruleStatusEnum("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  resolvedAmbiguities: jsonb("resolved_ambiguities"),
  resolvedEdgeCases: jsonb("resolved_edge_cases"),
  compiledConditions: jsonb("compiled_conditions"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const ruleVersionsTable = pgTable("rule_versions", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").notNull().references(() => rulesTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  naturalLanguageText: text("natural_language_text").notNull(),
  structuredRepresentation: jsonb("structured_representation"),
  outcome: ruleOutcomeEnum("outcome").notNull(),
  changedBy: text("changed_by"),
  changeNote: text("change_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRuleSchema = createInsertSchema(rulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRule = z.infer<typeof insertRuleSchema>;
export type Rule = typeof rulesTable.$inferSelect;
export type RuleVersion = typeof ruleVersionsTable.$inferSelect;
