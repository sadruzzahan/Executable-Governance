import { send400 } from "../lib/validation";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, organizationsTable } from "@workspace/db";
import {
  CreateOrganizationBody,
  GetOrganizationParams,
  UpdateOrganizationParams,
  UpdateOrganizationBody,
  DeleteOrganizationParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/rbac";
import { loadOrgScopedOrganization } from "../lib/orgScope";
import { auditWrite } from "../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/organizations", requirePermission("organization.read"), async (req, res): Promise<void> => {
  // Members only ever see their own org. Cross-tenant org enumeration
  // is never permitted regardless of role.
  const rows = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, req.user!.organizationId));
  res.json(rows);
});

router.post("/organizations", requirePermission("organization.create"), async (req, res): Promise<void> => {
  const parsed = CreateOrganizationBody.safeParse(req.body);
  if (!parsed.success) {
    send400(res, req, parsed.error);
    return;
  }
  // Reserved for the Onboarding/signup task — admins of an existing
  // org cannot spawn new orgs from inside the app today.
  res.status(403).json({
    error: "forbidden",
    message: "Creating new organizations is reserved for the signup flow.",
    requestId: req.requestId,
  });
});

router.get("/organizations/:id", requirePermission("organization.read"), async (req, res): Promise<void> => {
  const params = GetOrganizationParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const row = await loadOrgScopedOrganization(params.data.id, req.user!.organizationId);
  if (!row) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  res.json(row);
});

router.patch("/organizations/:id", requirePermission("organization.update"), async (req, res): Promise<void> => {
  const params = UpdateOrganizationParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const parsed = UpdateOrganizationBody.safeParse(req.body);
  if (!parsed.success) {
    send400(res, req, parsed.error);
    return;
  }
  const existing = await loadOrgScopedOrganization(params.data.id, req.user!.organizationId);
  if (!existing) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (parsed.data.name != null) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.industry !== undefined) updates.industry = parsed.data.industry;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [row] = await db.update(organizationsTable).set(updates).where(eq(organizationsTable.id, params.data.id)).returning();
  auditWrite({
    req,
    action: "organization.update",
    resourceType: "organization",
    resourceId: row.id,
    result: "success",
    metadata: { fields: Object.keys(updates) },
  });
  res.json(row);
});

router.delete("/organizations/:id", requirePermission("organization.delete"), async (req, res): Promise<void> => {
  const params = DeleteOrganizationParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  // Deleting an organization from inside that organization is too easy
  // to fat-finger and cascades into every policy/rule/decision/user.
  // We block it here and route teardown through ops/support.
  void params;
  res.status(403).json({
    error: "forbidden",
    message: "Org deletion goes through support, not the API.",
    requestId: req.requestId,
  });
});

export default router;
