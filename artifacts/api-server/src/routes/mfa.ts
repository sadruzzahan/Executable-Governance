/**
 * TOTP MFA enrollment, verification, and recovery code management.
 *
 * Enrollment is a two-step flow:
 *   1. POST /enroll-start — server generates a fresh secret, returns it
 *      as both an otpauth:// URL and a QR data-url. The secret row is
 *      stored with `enabledAt = null` so until the user proves they
 *      scanned it, MFA is not yet enforced on login.
 *   2. POST /enroll-verify — user posts the first 6-digit code; on
 *      success the row is marked enabled, recovery codes are minted,
 *      and the plaintext codes are returned to the client exactly once.
 */
import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  mfaSecretsTable,
  mfaRecoveryCodesTable,
  userSessionsTable,
} from "@workspace/db";
import { requireAuth, requireVerifiedEmail } from "../middlewares/auth";
import { send400 } from "../lib/validation";
import {
  encryptSecret,
  decryptSecret,
  startEnrollment,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
} from "../lib/totp";
import { verifyPassword } from "../lib/passwords";
import { userPasswordsTable } from "@workspace/db";
import { sendEmail } from "../lib/email";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/account/mfa/status", async (req, res) => {
  const [row] = await db
    .select()
    .from(mfaSecretsTable)
    .where(eq(mfaSecretsTable.userId, req.user!.id));
  const remaining = row && row.enabledAt
    ? await db
        .select({ id: mfaRecoveryCodesTable.id })
        .from(mfaRecoveryCodesTable)
        .where(
          and(
            eq(mfaRecoveryCodesTable.userId, req.user!.id),
            isNull(mfaRecoveryCodesTable.usedAt),
          ),
        )
    : [];
  res.json({
    enrolled: !!row,
    enabled: !!(row && row.enabledAt),
    enabledAt: row?.enabledAt ?? null,
    recoveryCodesRemaining: remaining.length,
  });
});

router.post("/account/mfa/enroll-start", async (req, res) => {
  const artifacts = await startEnrollment(req.user!.email);
  await db
    .insert(mfaSecretsTable)
    .values({ userId: req.user!.id, secretEnc: encryptSecret(artifacts.secret) })
    .onConflictDoUpdate({
      target: mfaSecretsTable.userId,
      set: { secretEnc: encryptSecret(artifacts.secret), enabledAt: null },
    });
  res.json({
    otpauthUrl: artifacts.otpauthUrl,
    qrDataUrl: artifacts.qrDataUrl,
  });
});

const VerifyBody = z.object({ code: z.string().regex(/^\d{6}$/) });

router.post("/account/mfa/enroll-verify", async (req, res) => {
  const parsed = VerifyBody.safeParse(req.body);
  if (!parsed.success) return send400(res, req, parsed.error);
  const [row] = await db
    .select()
    .from(mfaSecretsTable)
    .where(eq(mfaSecretsTable.userId, req.user!.id));
  if (!row) {
    res.status(400).json({ error: "not_enrolling", requestId: req.requestId });
    return;
  }
  if (!(await verifyTotp(decryptSecret(row.secretEnc), parsed.data.code))) {
    res.status(400).json({
      error: "invalid_code",
      message: "Code did not match. Try again.",
      requestId: req.requestId,
    });
    return;
  }
  const codes = generateRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx
      .update(mfaSecretsTable)
      .set({ enabledAt: new Date() })
      .where(eq(mfaSecretsTable.userId, req.user!.id));
    await tx
      .delete(mfaRecoveryCodesTable)
      .where(eq(mfaRecoveryCodesTable.userId, req.user!.id));
    await tx
      .insert(mfaRecoveryCodesTable)
      .values(
        codes.map((c) => ({ userId: req.user!.id, codeHash: hashRecoveryCode(c) })),
      );
    // Current session has just proved the second factor.
    await tx
      .update(userSessionsTable)
      .set({ mfaPassed: true })
      .where(eq(userSessionsTable.id, req.session!.id));
  });
  await sendEmail({
    to: req.user!.email,
    kind: "mfa_enabled",
    subject: "Two-factor authentication enabled",
    body: "MFA was enabled on your account. Keep your recovery codes somewhere safe.",
  });
  res.json({ recoveryCodes: codes });
});

const DisableBody = z.object({
  password: z.string().min(1).max(256),
});

router.post("/account/mfa/disable", requireVerifiedEmail, async (req, res) => {
  const parsed = DisableBody.safeParse(req.body);
  if (!parsed.success) return send400(res, req, parsed.error);
  const [pw] = await db
    .select()
    .from(userPasswordsTable)
    .where(eq(userPasswordsTable.userId, req.user!.id));
  if (!pw || !(await verifyPassword(parsed.data.password, pw.hash))) {
    res.status(401).json({ error: "invalid_password", requestId: req.requestId });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(mfaSecretsTable).where(eq(mfaSecretsTable.userId, req.user!.id));
    await tx
      .delete(mfaRecoveryCodesTable)
      .where(eq(mfaRecoveryCodesTable.userId, req.user!.id));
  });
  res.json({ ok: true });
});

router.post("/account/mfa/recovery-codes/regenerate", async (req, res) => {
  const [row] = await db
    .select()
    .from(mfaSecretsTable)
    .where(eq(mfaSecretsTable.userId, req.user!.id));
  if (!row || !row.enabledAt) {
    res.status(400).json({ error: "mfa_not_enabled", requestId: req.requestId });
    return;
  }
  const codes = generateRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx
      .delete(mfaRecoveryCodesTable)
      .where(eq(mfaRecoveryCodesTable.userId, req.user!.id));
    await tx
      .insert(mfaRecoveryCodesTable)
      .values(
        codes.map((c) => ({ userId: req.user!.id, codeHash: hashRecoveryCode(c) })),
      );
  });
  res.json({ recoveryCodes: codes });
});

export default router;
