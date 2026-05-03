/**
 * Org-wide security policy. For now: an admin-only switch that requires
 * every member to enroll in MFA. RBAC will tighten this in a follow-up
 * task; until then the role check stays inline.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, organizationsTable, mfaSecretsTable } from "@workspace/db";
import { requireAuth, requireVerifiedEmail } from "../middlewares/auth";
import { requirePermission } from "../middlewares/rbac";
import { auditWrite } from "../lib/audit";
import { send400 } from "../lib/validation";

const router: IRouter = Router();
router.use(requireAuth);

const SecurityBody = z.object({ requireMfa: z.boolean() });
const SecurityParams = z.object({ id: z.coerce.number().int().positive() });

router.get("/organizations/:id/security", requirePermission("organization.read"), async (req, res) => {
  const params = SecurityParams.safeParse(req.params);
  if (!params.success) return send400(res, req, params.error);
  // Members can read their own org's policy; cross-org reads are
  // forbidden so the policy isn't a covert side-channel.
  if (req.user!.organizationId !== params.data.id) {
    res.status(403).json({ error: "forbidden", requestId: req.requestId });
    return;
  }
  const [row] = await db
    .select({ requireMfa: organizationsTable.requireMfa })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "not_found", requestId: req.requestId });
    return;
  }
  res.json({ requireMfa: row.requireMfa });
});

router.patch(
  "/organizations/:id/security",
  requireVerifiedEmail,
  requirePermission("organization.security"),
  async (req, res) => {
  const params = SecurityParams.safeParse(req.params);
  if (!params.success) return send400(res, req, params.error);
  const body = SecurityBody.safeParse(req.body);
  if (!body.success) return send400(res, req, body.error);

  // Cross-org safety net: even an admin can only change their own
  // organization's security policy. The matrix already gates the verb;
  // this stops an admin of org A from PATCH-ing org B's row.
  if (req.user!.organizationId !== params.data.id) {
    res.status(404).json({ error: "not_found", requestId: req.requestId });
    return;
  }

  // Guardrail: an admin enabling org-wide MFA must already have MFA on
  // themselves; otherwise the next request from this admin would be
  // blocked by the org-MFA gate, locking the org out of its own policy.
  if (body.data.requireMfa) {
    const [adminMfa] = await db
      .select({ enabledAt: mfaSecretsTable.enabledAt })
      .from(mfaSecretsTable)
      .where(eq(mfaSecretsTable.userId, req.user!.id));
    if (!adminMfa?.enabledAt) {
      res.status(409).json({
        error: "admin_mfa_required",
        message: "Enable MFA on your own account before requiring it org-wide.",
        requestId: req.requestId,
      });
      return;
    }
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
  auditWrite({
    req,
    action: "organization.security",
    resourceType: "organization",
    resourceId: row.id,
    result: "success",
    metadata: { requireMfa: row.requireMfa },
  });
  res.json({ requireMfa: row.requireMfa });
});

export default router;
