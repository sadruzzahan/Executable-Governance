import { send400 } from "../lib/validation";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  CreateUserBody,
  GetUserParams,
  UpdateUserParams,
  UpdateUserBody,
  DeleteUserParams,
  ListUsersQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/rbac";
import { loadOrgScopedUser } from "../lib/orgScope";
import { auditWrite } from "../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/users", requirePermission("user.read"), async (req, res): Promise<void> => {
  const query = ListUsersQueryParams.safeParse(req.query);
  if (!query.success) {
    send400(res, req, query.error);
    return;
  }
  void query;
  // Force-scope to caller's org regardless of any organizationId filter.
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.organizationId, req.user!.organizationId))
    .orderBy(usersTable.id);
  res.json(rows);
});

router.post("/users", requirePermission("user.invite"), async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    send400(res, req, parsed.error);
    return;
  }
  // Force the new user into the caller's org.
  const [row] = await db
    .insert(usersTable)
    .values({ ...parsed.data, organizationId: req.user!.organizationId })
    .returning();
  auditWrite({
    req,
    action: "user.invite",
    resourceType: "user",
    resourceId: row.id,
    result: "success",
    metadata: { email: row.email, role: row.role },
  });
  res.status(201).json(row);
});

router.get("/users/:id", requirePermission("user.read"), async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const row = await loadOrgScopedUser(params.data.id, req.user!.organizationId);
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(row);
});

router.patch("/users/:id", requirePermission("user.update"), async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    send400(res, req, parsed.error);
    return;
  }
  const target = await loadOrgScopedUser(params.data.id, req.user!.organizationId);
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (parsed.data.name != null) updates.name = parsed.data.name;
  if (parsed.data.email != null) updates.email = parsed.data.email;
  if (parsed.data.role != null) updates.role = parsed.data.role;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [row] = await db.update(usersTable).set(updates).where(eq(usersTable.id, params.data.id)).returning();
  auditWrite({
    req,
    action: "user.update",
    resourceType: "user",
    resourceId: row.id,
    result: "success",
    metadata: { fields: Object.keys(updates) },
  });
  res.json(row);
});

router.delete("/users/:id", requirePermission("user.delete"), async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const target = await loadOrgScopedUser(params.data.id, req.user!.organizationId);
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  // Prevent admins from deleting themselves out of their own org.
  if (target.id === req.user!.id) {
    res.status(409).json({
      error: "self_delete_forbidden",
      message: "Use account deletion in Settings → Danger to remove your own account.",
      requestId: req.requestId,
    });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
  auditWrite({
    req,
    action: "user.delete",
    resourceType: "user",
    resourceId: params.data.id,
    result: "success",
  });
  res.sendStatus(204);
});

export default router;
