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
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/rules", async (req, res): Promise<void> => {
  const query = ListRulesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const conditions = [];
  if (query.data.policyId != null) conditions.push(eq(rulesTable.policyId, query.data.policyId));
  if (query.data.status != null) conditions.push(eq(rulesTable.status, query.data.status));

  const rows = await db
    .select()
    .from(rulesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(rulesTable.priority);
  res.json(rows);
});

router.post("/rules", async (req, res): Promise<void> => {
  const parsed = CreateRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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

  res.status(201).json(row);
});

router.get("/rules/:id", async (req, res): Promise<void> => {
  const params = GetRuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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

  if (!row) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }

  const versions = await db.select().from(ruleVersionsTable).where(eq(ruleVersionsTable.ruleId, params.data.id)).orderBy(desc(ruleVersionsTable.version));

  res.json({ ...row, versions });
});

router.patch("/rules/:id", async (req, res): Promise<void> => {
  const params = UpdateRuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(rulesTable).where(eq(rulesTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }

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

  res.json(row);
});

router.delete("/rules/:id", async (req, res): Promise<void> => {
  const params = DeleteRuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(rulesTable).where(eq(rulesTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/rules/:id/publish", async (req, res): Promise<void> => {
  const params = PublishRuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.update(rulesTable).set({ status: "published" }).where(eq(rulesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  res.json(row);
});

router.get("/rules/:id/versions", async (req, res): Promise<void> => {
  const params = GetRuleVersionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db.select().from(ruleVersionsTable).where(eq(ruleVersionsTable.ruleId, params.data.id)).orderBy(desc(ruleVersionsTable.version));
  res.json(rows);
});

export default router;
