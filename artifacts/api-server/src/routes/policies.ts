import { send400 } from "../lib/validation";
import { Router, type IRouter } from "express";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
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
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/rbac";
import { loadOrgScopedPolicy } from "../lib/orgScope";
import { auditWrite } from "../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/policies", requirePermission("policy.read"), async (req, res): Promise<void> => {
  const query = ListPoliciesQueryParams.safeParse(req.query);
  if (!query.success) {
    send400(res, req, query.error);
    return;
  }

  // Cross-tenant isolation: every list query is forced to the caller's
  // org regardless of whether they passed an organizationId filter, so
  // a reader from org A can never enumerate org B's policies.
  const orgId = req.user!.organizationId;
  const conditions = [eq(policiesTable.organizationId, orgId)];
  if (query.data.status != null) conditions.push(eq(policiesTable.status, query.data.status));
  // Readers can only see published policies; drafters/admins see all in their org.
  if (req.user!.role === "reader") {
    conditions.push(eq(policiesTable.status, "published"));
  }

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
    .where(and(...conditions))
    .groupBy(policiesTable.id, organizationsTable.name)
    .orderBy(desc(policiesTable.updatedAt));

  res.json(rows);
});

router.post("/policies", requirePermission("policy.create"), async (req, res): Promise<void> => {
  const parsed = CreatePolicyBody.safeParse(req.body);
  if (!parsed.success) {
    send400(res, req, parsed.error);
    return;
  }
  // Cross-tenant: force the new policy into the caller's org regardless
  // of any organizationId in the body.
  const [row] = await db
    .insert(policiesTable)
    .values({ ...parsed.data, organizationId: req.user!.organizationId })
    .returning();
  auditWrite({
    req,
    action: "policy.create",
    resourceType: "policy",
    resourceId: row.id,
    result: "success",
    metadata: { name: row.name, domain: row.domain },
  });
  res.status(201).json(row);
});

router.get("/policies/:id", requirePermission("policy.read"), async (req, res): Promise<void> => {
  const params = GetPolicyParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const policy = await loadOrgScopedPolicy(params.data.id, req.user!.organizationId);
  if (!policy) {
    res.status(404).json({ error: "Policy not found" });
    return;
  }
  // Readers cannot see drafts.
  if (req.user!.role === "reader" && policy.status !== "published") {
    res.status(404).json({ error: "Policy not found" });
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

  const ruleConditions = [eq(rulesTable.policyId, params.data.id)];
  if (req.user!.role === "reader") ruleConditions.push(eq(rulesTable.status, "published"));
  const rules = await db
    .select()
    .from(rulesTable)
    .where(and(...ruleConditions))
    .orderBy(rulesTable.priority);
  res.json({ ...row, rules });
});

router.patch("/policies/:id", requirePermission("policy.update"), async (req, res): Promise<void> => {
  const params = UpdatePolicyParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const parsed = UpdatePolicyBody.safeParse(req.body);
  if (!parsed.success) {
    send400(res, req, parsed.error);
    return;
  }
  const policy = await loadOrgScopedPolicy(params.data.id, req.user!.organizationId);
  if (!policy) {
    res.status(404).json({ error: "Policy not found" });
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
  auditWrite({
    req,
    action: "policy.update",
    resourceType: "policy",
    resourceId: row.id,
    result: "success",
    metadata: { fields: Object.keys(updates) },
  });
  res.json(row);
});

router.delete("/policies/:id", requirePermission("policy.delete"), async (req, res): Promise<void> => {
  const params = DeletePolicyParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const policy = await loadOrgScopedPolicy(params.data.id, req.user!.organizationId);
  if (!policy) {
    res.status(404).json({ error: "Policy not found" });
    return;
  }
  await db.delete(policiesTable).where(eq(policiesTable.id, params.data.id));
  auditWrite({
    req,
    action: "policy.delete",
    resourceType: "policy",
    resourceId: params.data.id,
    result: "success",
  });
  res.sendStatus(204);
});

router.post("/policies/:id/publish", requirePermission("policy.publish"), async (req, res): Promise<void> => {
  const params = PublishPolicyParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const policy = await loadOrgScopedPolicy(params.data.id, req.user!.organizationId);
  if (!policy) {
    res.status(404).json({ error: "Policy not found" });
    return;
  }
  const [row] = await db.update(policiesTable).set({ status: "published" }).where(eq(policiesTable.id, params.data.id)).returning();
  auditWrite({
    req,
    action: "policy.publish",
    resourceType: "policy",
    resourceId: row.id,
    result: "success",
  });
  res.json(row);
});

router.post("/policies/:id/archive", requirePermission("policy.archive"), async (req, res): Promise<void> => {
  const params = ArchivePolicyParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const policy = await loadOrgScopedPolicy(params.data.id, req.user!.organizationId);
  if (!policy) {
    res.status(404).json({ error: "Policy not found" });
    return;
  }
  const [row] = await db.update(policiesTable).set({ status: "archived" }).where(eq(policiesTable.id, params.data.id)).returning();
  auditWrite({
    req,
    action: "policy.archive",
    resourceType: "policy",
    resourceId: row.id,
    result: "success",
  });
  res.json(row);
});

// Suppress unused-import warnings for symbols the policy router only
// occasionally needs (e.g. inArray for future bulk endpoints).
void inArray;

export default router;
