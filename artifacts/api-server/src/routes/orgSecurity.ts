/**
 * Org-wide security policy. For now: an admin-only switch that requires
 * every member to enroll in MFA. RBAC will tighten this in a follow-up
 * task; until then the role check stays inline.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, organizationsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { send400 } from "../lib/validation";

const router: IRouter = Router();
router.use(requireAuth);

const SecurityBody = z.object({ requireMfa: z.boolean() });
const SecurityParams = z.object({ id: z.coerce.number().int().positive() });

router.patch("/organizations/:id/security", async (req, res) => {
  const params = SecurityParams.safeParse(req.params);
  if (!params.success) return send400(res, req, params.error);
  const body = SecurityBody.safeParse(req.body);
  if (!body.success) return send400(res, req, body.error);

  if (req.user!.role !== "admin" || req.user!.organizationId !== params.data.id) {
    res.status(403).json({
      error: "forbidden",
      message: "Only org admins can change security policy.",
      requestId: req.requestId,
    });
    return;
  }

  const [row] = await db
    .update(organizationsTable)
    .set({ requireMfa: body.data.requireMfa })
    .where(eq(organizationsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "not_found", requestId: req.requestId });
    return;
  }
  res.json({ requireMfa: row.requireMfa });
});

export default router;
