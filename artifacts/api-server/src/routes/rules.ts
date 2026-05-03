import { send400 } from "../lib/validation";
import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, rulesTable, ruleVersionsTable, policiesTable } from "@workspace/db";
import {
  CreateRuleBody,
  GetRuleParams,
  UpdateRuleParams,
  UpdateRuleBody,
  DeleteRuleParams,
  PublishRuleParams,
  GetRuleVersionsParams,
  ListRulesQueryParams,
  GetRuleVersionDiffParams,
  GetRuleVersionDiffQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/rbac";
import { loadOrgScopedRule, loadOrgScopedPolicy } from "../lib/orgScope";
import { auditWrite } from "../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

function compileRuleConditions(structuredRepresentation: unknown): Array<{ field: string; operator: string; value: unknown; kind: string }> {
  if (!structuredRepresentation || typeof structuredRepresentation !== "object") return [];
  const obj = structuredRepresentation as Record<string, unknown>;
  if (typeof obj.field === "string" && obj.operator !== undefined) {
    return [{ field: obj.field, operator: String(obj.operator), value: obj.value, kind: typeof obj.kind === "string" ? obj.kind : "threshold" }];
  }
  if (Array.isArray(obj.conditions)) {
    return (obj.conditions as Record<string, unknown>[])
      .filter((c) => typeof c.field === "string")
      .map((c) => ({ field: String(c.field), operator: String(c.operator ?? "="), value: c.value, kind: String(c.kind ?? "threshold") }));
  }
  return [];
}

router.get("/rules", requirePermission("rule.read"), async (req, res): Promise<void> => {
  const query = ListRulesQueryParams.safeParse(req.query);
  if (!query.success) {
    send400(res, req, query.error);
    return;
  }
  const orgId = req.user!.organizationId;
  // Force-filter by org via a join on the rule's parent policy.
  const conditions = [eq(policiesTable.organizationId, orgId)];
  if (query.data.policyId != null) conditions.push(eq(rulesTable.policyId, query.data.policyId));
  if (query.data.status != null) conditions.push(eq(rulesTable.status, query.data.status));
  if (req.user!.role === "reader") conditions.push(eq(rulesTable.status, "published"));

  const rows = await db
    .select({
      id: rulesTable.id,
      policyId: rulesTable.policyId,
      name: rulesTable.name,
      naturalLanguageText: rulesTable.naturalLanguageText,
      structuredRepresentation: rulesTable.structuredRepresentation,
      outcome: rulesTable.outcome,
      priority: rulesTable.priority,
      status: rulesTable.status,
      version: rulesTable.version,
      resolvedAmbiguities: rulesTable.resolvedAmbiguities,
      resolvedEdgeCases: rulesTable.resolvedEdgeCases,
      compiledConditions: rulesTable.compiledConditions,
      createdAt: rulesTable.createdAt,
      updatedAt: rulesTable.updatedAt,
    })
    .from(rulesTable)
    .innerJoin(policiesTable, eq(rulesTable.policyId, policiesTable.id))
    .where(and(...conditions))
    .orderBy(rulesTable.priority);
  res.json(rows);
});

router.post("/rules", requirePermission("rule.create"), async (req, res): Promise<void> => {
  const parsed = CreateRuleBody.safeParse(req.body);
  if (!parsed.success) {
    send400(res, req, parsed.error);
    return;
  }
  // Verify the parent policy belongs to the caller's org before creating
  // a rule under it (cross-org rule injection vector).
  const parent = await loadOrgScopedPolicy(parsed.data.policyId, req.user!.organizationId);
  if (!parent) {
    res.status(404).json({ error: "Policy not found" });
    return;
  }
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(rulesTable).values(parsed.data).returning();
    await tx.insert(ruleVersionsTable).values({
      ruleId: created.id,
      version: 1,
      naturalLanguageText: created.naturalLanguageText,
      structuredRepresentation: created.structuredRepresentation,
      outcome: created.outcome,
      changeNote: "Initial version",
    });
    return created;
  });
  auditWrite({
    req,
    action: "rule.create",
    resourceType: "rule",
    resourceId: row.id,
    result: "success",
    metadata: { policyId: row.policyId, name: row.name },
  });

  res.status(201).json(row);
});

router.get("/rules/:id", requirePermission("rule.read"), async (req, res): Promise<void> => {
  const params = GetRuleParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const scoped = await loadOrgScopedRule(params.data.id, req.user!.organizationId);
  if (!scoped) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  if (req.user!.role === "reader" && scoped.status !== "published") {
    res.status(404).json({ error: "Rule not found" });
    return;
  }

  const [row] = await db
    .select({
      id: rulesTable.id,
      policyId: rulesTable.policyId,
      name: rulesTable.name,
      naturalLanguageText: rulesTable.naturalLanguageText,
      structuredRepresentation: rulesTable.structuredRepresentation,
      outcome: rulesTable.outcome,
      priority: rulesTable.priority,
      status: rulesTable.status,
      version: rulesTable.version,
      resolvedAmbiguities: rulesTable.resolvedAmbiguities,
      resolvedEdgeCases: rulesTable.resolvedEdgeCases,
      createdAt: rulesTable.createdAt,
      updatedAt: rulesTable.updatedAt,
      policyName: policiesTable.name,
    })
    .from(rulesTable)
    .leftJoin(policiesTable, eq(rulesTable.policyId, policiesTable.id))
    .where(eq(rulesTable.id, params.data.id));

  const versions = await db.select().from(ruleVersionsTable).where(eq(ruleVersionsTable.ruleId, params.data.id)).orderBy(desc(ruleVersionsTable.version));

  res.json({ ...row, versions });
});

router.patch("/rules/:id", requirePermission("rule.update"), async (req, res): Promise<void> => {
  const params = UpdateRuleParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const parsed = UpdateRuleBody.safeParse(req.body);
  if (!parsed.success) {
    send400(res, req, parsed.error);
    return;
  }
  const scoped = await loadOrgScopedRule(params.data.id, req.user!.organizationId);
  if (!scoped) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }

  const [existing] = await db.select().from(rulesTable).where(eq(rulesTable.id, params.data.id));

  const updates: Record<string, unknown> = {};
  if (parsed.data.name != null) updates.name = parsed.data.name;
  if (parsed.data.naturalLanguageText != null) updates.naturalLanguageText = parsed.data.naturalLanguageText;
  if (parsed.data.outcome != null) updates.outcome = parsed.data.outcome;
  if (parsed.data.priority != null) updates.priority = parsed.data.priority;
  if (parsed.data.structuredRepresentation !== undefined) updates.structuredRepresentation = parsed.data.structuredRepresentation;
  if (parsed.data.resolvedAmbiguities !== undefined) updates.resolvedAmbiguities = parsed.data.resolvedAmbiguities;
  if (parsed.data.resolvedEdgeCases !== undefined) updates.resolvedEdgeCases = parsed.data.resolvedEdgeCases;

  const textChanged = parsed.data.naturalLanguageText != null && parsed.data.naturalLanguageText !== existing.naturalLanguageText;
  const outcomeChanged = parsed.data.outcome != null && parsed.data.outcome !== existing.outcome;
  const structuredChanged =
    parsed.data.structuredRepresentation !== undefined &&
    JSON.stringify(parsed.data.structuredRepresentation) !== JSON.stringify(existing.structuredRepresentation);
  const materialChange = textChanged || outcomeChanged || structuredChanged;

  if (materialChange) {
    updates.version = existing.version + 1;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(rulesTable).set(updates).where(eq(rulesTable.id, params.data.id)).returning();
    if (materialChange) {
      await tx.insert(ruleVersionsTable).values({
        ruleId: updated.id,
        version: updated.version,
        naturalLanguageText: updated.naturalLanguageText,
        structuredRepresentation: updated.structuredRepresentation,
        outcome: updated.outcome,
        changeNote: parsed.data.changeNote ?? null,
      });
    }
    return updated;
  });
  auditWrite({
    req,
    action: "rule.update",
    resourceType: "rule",
    resourceId: row.id,
    result: "success",
    metadata: { fields: Object.keys(updates), materialChange },
  });

  res.json(row);
});

router.delete("/rules/:id", requirePermission("rule.delete"), async (req, res): Promise<void> => {
  const params = DeleteRuleParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const scoped = await loadOrgScopedRule(params.data.id, req.user!.organizationId);
  if (!scoped) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  await db.delete(rulesTable).where(eq(rulesTable.id, params.data.id));
  auditWrite({
    req,
    action: "rule.delete",
    resourceType: "rule",
    resourceId: params.data.id,
    result: "success",
  });
  res.sendStatus(204);
});

router.post("/rules/:id/publish", requirePermission("rule.publish"), async (req, res): Promise<void> => {
  const params = PublishRuleParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const scoped = await loadOrgScopedRule(params.data.id, req.user!.organizationId);
  if (!scoped) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  const [existing] = await db.select().from(rulesTable).where(eq(rulesTable.id, params.data.id));
  const ambiguities = Array.isArray(existing.resolvedAmbiguities) ? existing.resolvedAmbiguities as Array<{ resolved?: boolean }> : [];
  const edgeCases = Array.isArray(existing.resolvedEdgeCases) ? existing.resolvedEdgeCases as Array<{ resolved?: boolean }> : [];
  const unresolvedCount = ambiguities.filter((a) => !a.resolved).length + edgeCases.filter((e) => !e.resolved).length;
  if (unresolvedCount > 0) {
    res.status(422).json({ error: `Cannot publish: ${unresolvedCount} unresolved analysis item(s). Resolve or override all flagged items first.` });
    return;
  }
  const compiledConditions = compileRuleConditions(existing.structuredRepresentation);
  const [row] = await db
    .update(rulesTable)
    .set({ status: "published", compiledConditions: compiledConditions.length > 0 ? compiledConditions : null })
    .where(eq(rulesTable.id, params.data.id))
    .returning();
  auditWrite({
    req,
    action: "rule.publish",
    resourceType: "rule",
    resourceId: row.id,
    result: "success",
  });
  res.json(row);
});

router.get("/rules/:id/versions", requirePermission("rule.read"), async (req, res): Promise<void> => {
  const params = GetRuleVersionsParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const scoped = await loadOrgScopedRule(params.data.id, req.user!.organizationId);
  if (!scoped) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  const rows = await db.select().from(ruleVersionsTable).where(eq(ruleVersionsTable.ruleId, params.data.id)).orderBy(desc(ruleVersionsTable.version));
  res.json(rows);
});

router.get("/rules/:id/diff", requirePermission("rule.read"), async (req, res): Promise<void> => {
  const params = GetRuleVersionDiffParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const query = GetRuleVersionDiffQueryParams.safeParse(req.query);
  if (!query.success) {
    send400(res, req, query.error);
    return;
  }
  const scoped = await loadOrgScopedRule(params.data.id, req.user!.organizationId);
  if (!scoped) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  const versions = await db
    .select()
    .from(ruleVersionsTable)
    .where(eq(ruleVersionsTable.ruleId, params.data.id));
  const from = versions.find((v) => v.version === query.data.from);
  const to = versions.find((v) => v.version === query.data.to);
  if (!from || !to) {
    res.status(404).json({ error: "Version not found" });
    return;
  }
  const fields: Array<keyof typeof from> = ["naturalLanguageText", "outcome", "structuredRepresentation"];
  const changes = fields
    .filter((f) => JSON.stringify(from[f]) !== JSON.stringify(to[f]))
    .map((f) => ({ field: f as string, before: from[f], after: to[f] }));
  res.json({ ruleId: params.data.id, from, to, changes });
});

export default router;
