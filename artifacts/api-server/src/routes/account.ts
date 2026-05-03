/**
 * Authenticated account-management routes mounted under /api/account.
 *
 * Profile edits, email-change requests (which trigger a verification
 * email — the address is not switched until the link is clicked),
 * password change with current-password proof + strength + HIBP, and
 * a soft account-deletion entry that hands off to the GDPR flow.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  usersTable,
  userPasswordsTable,
  emailVerificationTokensTable,
  passwordResetTokensTable,
  mfaSecretsTable,
  mfaRecoveryCodesTable,
} from "@workspace/db";
import { send400 } from "../lib/validation";
import { requireAuth, requireVerifiedEmail } from "../middlewares/auth";
import { hashPassword, verifyPassword, strengthScore } from "../lib/passwords";
import { checkPasswordPwned } from "../lib/hibp";
import { mintToken } from "../lib/tokens";
import { sendEmail, appLink } from "../lib/email";
import { revokeAllOtherSessions, revokeAllSessions, clearSessionCookie } from "../lib/sessions";

const router: IRouter = Router();
router.use(requireAuth);

const ProfileBody = z.object({
  name: z.string().min(1).max(160).optional(),
  timezone: z.string().min(1).max(64).optional(),
  locale: z.string().min(2).max(16).optional(),
  avatarUrl: z.string().url().max(2048).nullable().optional(),
});

router.patch("/account/profile", async (req, res) => {
  const parsed = ProfileBody.safeParse(req.body);
  if (!parsed.success) return send400(res, req, parsed.error);
  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.timezone !== undefined) updates.timezone = parsed.data.timezone;
  if (parsed.data.locale !== undefined) updates.locale = parsed.data.locale;
  if (parsed.data.avatarUrl !== undefined) updates.avatarUrl = parsed.data.avatarUrl;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "no_changes", requestId: req.requestId });
    return;
  }
  const [row] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, req.user!.id))
    .returning();
  res.json({ user: publicUser(row) });
});

const EmailChangeBody = z.object({ newEmail: z.string().email().max(320) });

router.post("/account/email-change-request", requireVerifiedEmail, async (req, res) => {
  const parsed = EmailChangeBody.safeParse(req.body);
  if (!parsed.success) return send400(res, req, parsed.error);
  if (parsed.data.newEmail.toLowerCase() === req.user!.email.toLowerCase()) {
    res.status(400).json({ error: "same_email", requestId: req.requestId });
    return;
  }
  const taken = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, parsed.data.newEmail));
  if (taken.length > 0) {
    res.status(409).json({
      error: "email_in_use",
      message: "That email is already in use.",
      requestId: req.requestId,
    });
    return;
  }
  const { token, hash } = mintToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(emailVerificationTokensTable).values({
    userId: req.user!.id,
    tokenHash: hash,
    pendingEmail: parsed.data.newEmail,
    expiresAt,
  });
  const link = appLink(`/verify-email?token=${encodeURIComponent(token)}`);
  await sendEmail({
    to: parsed.data.newEmail,
    kind: "email_change_verification",
    subject: "Confirm your new email address",
    body: `Click to confirm this address for your Executable Governance account (expires in 24 hours):\n\n${link}\n\nYour current email stays active until you click the link.`,
  });
  res.status(202).json({ ok: true });
});

const PasswordBody = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256),
});

router.post("/account/password", requireVerifiedEmail, async (req, res) => {
  const parsed = PasswordBody.safeParse(req.body);
  if (!parsed.success) return send400(res, req, parsed.error);

  const [pw] = await db
    .select()
    .from(userPasswordsTable)
    .where(eq(userPasswordsTable.userId, req.user!.id));
  if (!pw || !(await verifyPassword(parsed.data.currentPassword, pw.hash))) {
    res.status(401).json({
      error: "invalid_current_password",
      message: "Current password is incorrect.",
      requestId: req.requestId,
    });
    return;
  }

  const strength = strengthScore(parsed.data.newPassword);
  if (strength.score < 2) {
    res.status(400).json({
      error: "weak_password",
      message: "Password is too weak.",
      warnings: strength.warnings,
      requestId: req.requestId,
    });
    return;
  }
  const breach = await checkPasswordPwned(parsed.data.newPassword);
  if (breach.pwned) {
    res.status(400).json({
      error: "breached_password",
      message: `This password has appeared in ${breach.count} known breaches.`,
      requestId: req.requestId,
    });
    return;
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await db
    .update(userPasswordsTable)
    .set({ hash: newHash, updatedAt: new Date() })
    .where(eq(userPasswordsTable.userId, req.user!.id));
  const revoked = await revokeAllOtherSessions(req.user!.id, req.session!.id);
  await sendEmail({
    to: req.user!.email,
    kind: "password_changed",
    subject: "Your password was changed",
    body: "Your Executable Governance password was changed. All other sessions were signed out.",
  });
  res.json({ ok: true, otherSessionsRevoked: revoked });
});

router.post("/account/strength-check", (req, res) => {
  const value = typeof req.body?.password === "string" ? req.body.password : "";
  res.json(strengthScore(value));
});

// Resend a verification email for the user's CURRENT address. This is a
// distinct flow from /account/email-change-request, which mints a token
// for a NEW address — that endpoint rejects same-email requests so it
// cannot serve as the resend path.
router.post("/account/verification-resend", async (req, res) => {
  if (req.user!.emailVerifiedAt) {
    res.status(400).json({
      error: "already_verified",
      message: "Your email is already verified.",
      requestId: req.requestId,
    });
    return;
  }
  const { token, hash } = mintToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(emailVerificationTokensTable).values({
    userId: req.user!.id,
    tokenHash: hash,
    pendingEmail: null,
    expiresAt,
  });
  const link = appLink(`/verify-email?token=${encodeURIComponent(token)}`);
  await sendEmail({
    to: req.user!.email,
    kind: "email_verification",
    subject: "Verify your email address",
    body: `Click to verify your email for Executable Governance (expires in 24 hours):\n\n${link}`,
  });
  res.status(202).json({ ok: true });
});

router.delete("/account", requireVerifiedEmail, async (req, res) => {
  // Soft-delete entry: tag the user, queue the GDPR pipeline (downstream
  // task), and revoke every session so the user is signed out on all
  // devices immediately. Hard-delete + data export happens in the GDPR
  // flow once that's in place.
  await sendEmail({
    to: req.user!.email,
    kind: "account_deleted",
    subject: "Account deletion requested",
    body: "We've received your account deletion request. Your data will be removed per our retention policy. You have been signed out on all devices.",
  });
  // Mark email unverified + null name as a tombstone signal until the
  // GDPR flow lands; do NOT actually delete the user row because foreign
  // keys cascade through audit-critical tables (decisions, rule_versions).
  // Critically: wipe every credential so the tombstoned account can't be
  // resurrected via password-reset or MFA-recovery flows before the
  // downstream GDPR pipeline finishes the hard delete.
  const userId = req.user!.id;
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({ emailVerifiedAt: null, name: "(deletion pending)" })
      .where(eq(usersTable.id, userId));
    await tx.delete(userPasswordsTable).where(eq(userPasswordsTable.userId, userId));
    await tx.delete(mfaSecretsTable).where(eq(mfaSecretsTable.userId, userId));
    await tx.delete(mfaRecoveryCodesTable).where(eq(mfaRecoveryCodesTable.userId, userId));
    await tx
      .delete(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.userId, userId));
    await tx
      .delete(emailVerificationTokensTable)
      .where(eq(emailVerificationTokensTable.userId, userId));
  });
  await revokeAllSessions(userId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

function publicUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    organizationId: u.organizationId,
    avatarUrl: u.avatarUrl,
    timezone: u.timezone,
    locale: u.locale,
    emailVerifiedAt: u.emailVerifiedAt,
  };
}

export default router;
