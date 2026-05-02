import { Router, type IRouter } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import { db, policiesTable, rulesTable, organizationsTable } from "@workspace/db";
import {
  CreatePolicyBody,
  GetPolicyParams,
  UpdatePolicyParams,
  UpdatePolicyBody,
  DeletePolicyParams,
  PublishPolicyParams,
  ArchivePolicyParams,
  ListPoliciesQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/policies", async (req, res): Promise<void> => {
  const query = ListPoliciesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions = [];
  if (query.data.organizationId != null) conditions.push(eq(policiesTable.organizationId, query.data.organizationId));
  if (query.data.status != null) conditions.push(eq(policiesTable.status, query.data.status));

  const rows = await db
    .select({
      id: policiesTable.id,
      organizationId: policiesTable.organizationId,
      name: policiesTable.name,
      description: policiesTable.description,
      domain: policiesTable.domain,
      status: policiesTable.status,
      version: policiesTable.version,
      createdAt: policiesTable.createdAt,
      updatedAt: policiesTable.updatedAt,
      organizationName: organizationsTable.name,
      ruleCount: sql<number>`cast(count(${rulesTable.id}) as int)`,
      publishedRuleCount: sql<number>`cast(coalesce(sum(case when ${rulesTable.status} = 'published' then 1 else 0 end), 0) as int)`,
      draftRuleCount: sql<number>`cast(coalesce(sum(case when ${rulesTable.status} = 'draft' then 1 else 0 end), 0) as int)`,
    })
    .from(policiesTable)
    .leftJoin(organizationsTable, eq(policiesTable.organizationId, organizationsTable.id))
    .leftJoin(rulesTable, eq(rulesTable.policyId, policiesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(policiesTable.id, organizationsTable.name)
    .orderBy(desc(policiesTable.updatedAt));

  res.json(rows);
});

router.post("/policies", async (req, res): Promise<void> => {
  const parsed = CreatePolicyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(policiesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.get("/policies/:id", async (req, res): Promise<void> => {
  const params = GetPolicyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select({
      id: policiesTable.id,
      organizationId: policiesTable.organizationId,
      name: policiesTable.name,
      description: policiesTable.description,
      domain: policiesTable.domain,
      status: policiesTable.status,
      version: policiesTable.version,
      createdAt: policiesTable.createdAt,
      updatedAt: policiesTable.updatedAt,
      organizationName: organizationsTable.name,
    })
    .from(policiesTable)
    .leftJoin(organizationsTable, eq(policiesTable.organizationId, organizationsTable.id))
    .where(eq(policiesTable.id, params.data.id));

  if (!row) {
    res.status(404).json({ error: "Policy not found" });
    return;
  }

  const rules = await db.select().from(rulesTable).where(eq(rulesTable.policyId, params.data.id)).orderBy(rulesTable.priority);
  res.json({ ...row, rules });
});

router.patch("/policies/:id", async (req, res): Promise<void> => {
  const params = UpdatePolicyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePolicyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (parsed.data.name != null) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.domain != null) updates.domain = parsed.data.domain;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [row] = await db.update(policiesTable).set(updates).where(eq(policiesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Policy not found" });
    return;
  }
  res.json(row);
});

router.delete("/policies/:id", async (req, res): Promise<void> => {
  const params = DeletePolicyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(policiesTable).where(eq(policiesTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/policies/:id/publish", async (req, res): Promise<void> => {
  const params = PublishPolicyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.update(policiesTable).set({ status: "published" }).where(eq(policiesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Policy not found" });
    return;
  }
  res.json(row);
});

router.post("/policies/:id/archive", async (req, res): Promise<void> => {
  const params = ArchivePolicyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.update(policiesTable).set({ status: "archived" }).where(eq(policiesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Policy not found" });
    return;
  }
  res.json(row);
});

export default router;
