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

const router: IRouter = Router();

router.get("/organizations", async (_req, res): Promise<void> => {
  const rows = await db.select().from(organizationsTable).orderBy(organizationsTable.id);
  res.json(rows);
});

router.post("/organizations", async (req, res): Promise<void> => {
  const parsed = CreateOrganizationBody.safeParse(req.body);
  if (!parsed.success) {
    send400(res, req, parsed.error);
    return;
  }
  const [row] = await db.insert(organizationsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.get("/organizations/:id", async (req, res): Promise<void> => {
  const params = GetOrganizationParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  const [row] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  res.json(row);
});

router.patch("/organizations/:id", async (req, res): Promise<void> => {
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
  const updates: Record<string, unknown> = {};
  if (parsed.data.name != null) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.industry !== undefined) updates.industry = parsed.data.industry;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [row] = await db.update(organizationsTable).set(updates).where(eq(organizationsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  res.json(row);
});

router.delete("/organizations/:id", async (req, res): Promise<void> => {
  const params = DeleteOrganizationParams.safeParse(req.params);
  if (!params.success) {
    send400(res, req, params.error);
    return;
  }
  await db.delete(organizationsTable).where(eq(organizationsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
