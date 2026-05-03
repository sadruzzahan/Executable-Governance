/**
 * Active-sessions surface.
 *
 * Lists every non-revoked, non-expired session for the current user,
 * lets them revoke any single one (sign-out from a particular device)
 * or sweep every other session in one call ("sign out everywhere
 * else"). Revoking the current session falls back to /auth/logout to
 * clear the cookie too.
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, userSessionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { send400 } from "../lib/validation";
import { revokeSession, revokeAllOtherSessions } from "../lib/sessions";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/account/sessions", async (req, res) => {
  const rows = await db
    .select()
    .from(userSessionsTable)
    .where(
      and(
        eq(userSessionsTable.userId, req.user!.id),
        isNull(userSessionsTable.revokedAt),
        gt(userSessionsTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(userSessionsTable.lastSeenAt));
  res.json(
    rows.map((r) => ({
      id: r.id,
      deviceLabel: r.deviceLabel,
      ip: r.ip,
      userAgent: r.userAgent,
      mfaPassed: r.mfaPassed,
      createdAt: r.createdAt,
      lastSeenAt: r.lastSeenAt,
      expiresAt: r.expiresAt,
      current: r.id === req.session!.id,
    })),
  );
});

const RevokeParams = z.object({ id: z.coerce.number().int().positive() });

router.delete("/account/sessions/:id", async (req, res) => {
  const parsed = RevokeParams.safeParse(req.params);
  if (!parsed.success) return send400(res, req, parsed.error);
  const ok = await revokeSession(parsed.data.id, req.user!.id);
  if (!ok) {
    res.status(404).json({ error: "session_not_found", requestId: req.requestId });
    return;
  }
  res.json({ ok: true });
});

router.post("/account/sessions/revoke-others", async (req, res) => {
  const revoked = await revokeAllOtherSessions(req.user!.id, req.session!.id);
  res.json({ revoked });
});

export default router;
