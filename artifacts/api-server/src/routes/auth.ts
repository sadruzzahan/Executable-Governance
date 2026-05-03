/**
 * Authentication routes: login, logout, current user, password reset,
 * email verification.
 *
 * Login enforces:
 *   1. correct email + password (timing-equalised by always running the
 *      bcrypt compare — even when the user does not exist)
 *   2. TOTP code when MFA is enabled (or recovery code as fallback)
 *
 * On success the server mints a fresh session row, sets an httpOnly
 * cookie, and returns the user. The session is bound to the requesting
 * IP/user-agent so the active-sessions UI can show "where".
 */
import { Router, type IRouter } from "express";
import { and, eq, isNull, gt } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  usersTable,
  userPasswordsTable,
  passwordResetTokensTable,
  emailVerificationTokensTable,
  mfaSecretsTable,
  mfaRecoveryCodesTable,
  userSessionsTable,
} from "@workspace/db";
import { send400 } from "../lib/validation";
import { hashPassword, verifyPassword, strengthScore } from "../lib/passwords";
import { checkPasswordPwned } from "../lib/hibp";
import { decryptSecret, verifyTotp, hashRecoveryCode } from "../lib/totp";
import { mintToken, hashToken } from "../lib/tokens";
import { sendEmail, appLink } from "../lib/email";
import {
  createSession,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  loadSessionByToken,
  revokeAllSessions,
} from "../lib/sessions";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const PLACEHOLDER_HASH =
  "$2a$12$abcdefghijklmnopqrstuuewzD0e1Q5QfMHmZJqFfQQg1bJtOeZ5yC";

const LoginBody = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(8).max(20).optional(),
});

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) return send400(res, req, parsed.error);

  const { email, password, totpCode, recoveryCode } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  const [pwRow] = user
    ? await db.select().from(userPasswordsTable).where(eq(userPasswordsTable.userId, user.id))
    : [];

  // Always run a password verify to keep response timing constant whether
  // the user exists or not. This is a cheap defence against email enumeration.
  const ok = await verifyPassword(password, pwRow?.hash ?? PLACEHOLDER_HASH);
  // Tombstoned accounts: even if (somehow) credentials match, treat as
  // if the user does not exist. Account-deletion already wipes the row
  // out of user_passwords, so this is a defence-in-depth check that
  // also covers the no-credentials-yet window.
  if (!user || !pwRow || !ok || user.deletedAt) {
    res.status(401).json({
      error: "invalid_credentials",
      message: "Email or password is incorrect.",
      requestId: req.requestId,
    });
    return;
  }

  const [mfa] = await db
    .select()
    .from(mfaSecretsTable)
    .where(eq(mfaSecretsTable.userId, user.id));
  const mfaEnabled = mfa && mfa.enabledAt !== null;

  let mfaPassed = !mfaEnabled;
  if (mfaEnabled) {
    if (totpCode) {
      mfaPassed = await verifyTotp(decryptSecret(mfa.secretEnc), totpCode);
    } else if (recoveryCode) {
      const codeHash = hashRecoveryCode(recoveryCode);
      // Atomic single-use consume: the conditional UPDATE guarantees a
      // recovery code can only authenticate one concurrent login; the
      // race-losing requests get a falsy claim and fall through to the
      // mfa_required error branch below.
      const [claim] = await db
        .update(mfaRecoveryCodesTable)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(mfaRecoveryCodesTable.userId, user.id),
            eq(mfaRecoveryCodesTable.codeHash, codeHash),
            isNull(mfaRecoveryCodesTable.usedAt),
          ),
        )
        .returning({ id: mfaRecoveryCodesTable.id });
      if (claim) mfaPassed = true;
    }
    if (!mfaPassed) {
      res.status(401).json({
        error: "mfa_required",
        message: totpCode || recoveryCode ? "Code is incorrect." : "MFA code required.",
        mfaRequired: true,
        requestId: req.requestId,
      });
      return;
    }
  }

  const { token } = await createSession({
    userId: user.id,
    ip: req.ip,
    userAgent: req.header("user-agent") ?? undefined,
    mfaPassed,
  });
  setSessionCookie(res, token);

  res.json({ user: publicUser(user), mfaRequired: false });
});

router.post("/auth/logout", async (req, res) => {
  const token = readSessionCookie(req);
  if (token) {
    const found = await loadSessionByToken(token);
    if (found) {
      await db
        .update(userSessionsTable)
        .set({ revokedAt: new Date() })
        .where(eq(userSessionsTable.id, found.session.id));
    }
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const [mfa] = await db
    .select()
    .from(mfaSecretsTable)
    .where(eq(mfaSecretsTable.userId, req.user!.id));
  res.json({
    user: publicUser(req.user!),
    mfaEnabled: !!(mfa && mfa.enabledAt),
    sessionId: req.session!.id,
  });
});

const ForgotBody = z.object({ email: z.string().email().max(320) });

router.post("/auth/forgot-password", async (req, res) => {
  const parsed = ForgotBody.safeParse(req.body);
  if (!parsed.success) return send400(res, req, parsed.error);
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, parsed.data.email));
  // Always 202 so a stranger cannot probe which addresses are registered.
  // Tombstoned accounts are treated as non-existent: never mint a reset
  // token for a deleted user — that's the resurrection vector that
  // would let a deletion be undone before the GDPR pipeline finishes.
  if (user && !user.deletedAt) {
    const { token, hash } = mintToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await db.insert(passwordResetTokensTable).values({
      userId: user.id,
      tokenHash: hash,
      expiresAt,
    });
    const link = appLink(`/reset-password?token=${encodeURIComponent(token)}`);
    await sendEmail({
      to: user.email,
      kind: "password_reset",
      subject: "Reset your Executable Governance password",
      body: `Click the link to choose a new password (expires in 1 hour):\n\n${link}\n\nIf you did not request this, ignore this email.`,
    });
  }
  res.status(202).json({ ok: true });
});

const ResetBody = z.object({
  token: z.string().min(20).max(128),
  newPassword: z.string().min(12).max(256),
});

router.post("/auth/reset-password", async (req, res) => {
  const parsed = ResetBody.safeParse(req.body);
  if (!parsed.success) return send400(res, req, parsed.error);
  const tokenHash = hashToken(parsed.data.token);
  const [row] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, new Date()),
      ),
    );
  if (!row) {
    res.status(400).json({
      error: "invalid_token",
      message: "Reset link is invalid or has expired.",
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
      message: `This password has appeared in ${breach.count} known breaches. Choose another.`,
      requestId: req.requestId,
    });
    return;
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  // Atomic single-use consume: the conditional UPDATE re-checks the
  // single-use + not-expired predicates inside the same statement so two
  // concurrent requests cannot both pass and both reset the password.
  // Only the request that wins the row update proceeds to set the new
  // password; the loser sees consumed=null and gets the same invalid-
  // token error a stale link would.
  const consumed = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokensTable.id, row.id),
          isNull(passwordResetTokensTable.usedAt),
          gt(passwordResetTokensTable.expiresAt, new Date()),
        ),
      )
      .returning({ id: passwordResetTokensTable.id });
    if (!claimed) return null;
    await tx
      .insert(userPasswordsTable)
      .values({ userId: row.userId, hash: newHash })
      .onConflictDoUpdate({
        target: userPasswordsTable.userId,
        set: { hash: newHash, updatedAt: new Date() },
      });
    return claimed;
  });
  if (!consumed) {
    res.status(400).json({
      error: "invalid_token",
      message: "Reset link is invalid or has expired.",
      requestId: req.requestId,
    });
    return;
  }
  // Reset always invalidates every existing session for the user.
  await revokeAllSessions(row.userId);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, row.userId));
  if (user) {
    await sendEmail({
      to: user.email,
      kind: "password_changed",
      subject: "Your password was reset",
      body: "Your Executable Governance password was just reset. If this wasn't you, contact your administrator immediately.",
    });
  }
  res.json({ ok: true });
});

const VerifyBody = z.object({ token: z.string().min(20).max(128) });

router.post("/auth/verify-email", async (req, res) => {
  const parsed = VerifyBody.safeParse(req.body);
  if (!parsed.success) return send400(res, req, parsed.error);
  const tokenHash = hashToken(parsed.data.token);
  const [row] = await db
    .select()
    .from(emailVerificationTokensTable)
    .where(
      and(
        eq(emailVerificationTokensTable.tokenHash, tokenHash),
        isNull(emailVerificationTokensTable.usedAt),
        gt(emailVerificationTokensTable.expiresAt, new Date()),
      ),
    );
  if (!row) {
    res.status(400).json({
      error: "invalid_token",
      message: "Verification link is invalid or has expired.",
      requestId: req.requestId,
    });
    return;
  }
  // Verifying or changing the email of a tombstoned account would
  // resurrect contact with a deleted user — refuse.
  const [tombstoneCheck] = await db
    .select({ deletedAt: usersTable.deletedAt })
    .from(usersTable)
    .where(eq(usersTable.id, row.userId));
  if (tombstoneCheck?.deletedAt) {
    res.status(400).json({
      error: "invalid_token",
      message: "Verification link is invalid or has expired.",
      requestId: req.requestId,
    });
    return;
  }
  // Atomic single-use consume — see /auth/reset-password for rationale.
  const consumed = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(emailVerificationTokensTable)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailVerificationTokensTable.id, row.id),
          isNull(emailVerificationTokensTable.usedAt),
          gt(emailVerificationTokensTable.expiresAt, new Date()),
        ),
      )
      .returning({ id: emailVerificationTokensTable.id });
    if (!claimed) return null;
    if (row.pendingEmail) {
      await tx
        .update(usersTable)
        .set({ email: row.pendingEmail, emailVerifiedAt: new Date() })
        .where(eq(usersTable.id, row.userId));
    } else {
      await tx
        .update(usersTable)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(usersTable.id, row.userId));
    }
    return claimed;
  });
  if (!consumed) {
    res.status(400).json({
      error: "invalid_token",
      message: "Verification link is invalid or has expired.",
      requestId: req.requestId,
    });
    return;
  }
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
