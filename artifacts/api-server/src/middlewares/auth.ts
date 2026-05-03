/**
 * Session-cookie authentication middleware.
 *
 * Runs on every request: if a valid session cookie is present, the
 * matching user record is loaded and attached to the request. The
 * downstream `requireAuth` and `requireVerifiedEmail` handlers turn
 * that into hard 401/403 responses on the routes that need them.
 *
 * Authentication failures are deliberately silent here (the request
 * just continues anonymously); auth enforcement is a separate concern
 * so health/login/forgot-password can run without a session.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  mfaSecretsTable,
  type User,
  type UserSession,
} from "@workspace/db";
import { loadSessionByToken, readSessionCookie, touchSession } from "../lib/sessions";

declare module "http" {
  interface IncomingMessage {
    user?: User;
    session?: UserSession;
    userId?: number;
    organizationId?: number;
  }
}

export function sessionAuth(): RequestHandler {
  return async (req, _res, next) => {
    const token = readSessionCookie(req);
    if (!token) return next();
    try {
      const found = await loadSessionByToken(token);
      if (!found) return next();
      const { session, user } = found;
      req.user = user;
      req.session = session;
      req.userId = user.id;
      req.organizationId = user.organizationId;
      req.principal = { kind: "user", id: String(user.id) };
      // Fire-and-forget last-seen update; failures here must not block the request.
      touchSession(session.id).catch(() => undefined);
      next();
    } catch {
      next();
    }
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !req.session) {
    res
      .status(401)
      .json({ error: "unauthenticated", message: "Sign in required.", requestId: req.requestId });
    return;
  }
  next();
}

export function requireVerifiedEmail(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: "unauthenticated", requestId: req.requestId });
    return;
  }
  if (!req.user.emailVerifiedAt) {
    res.status(403).json({
      error: "email_unverified",
      message: "Verify your email address before performing this action.",
      requestId: req.requestId,
    });
    return;
  }
  next();
}

/** Login flow MFA gate: a session that hasn't completed MFA can only
 * call the MFA-verify endpoint or logout. */
export function requireMfaPassed(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user || !req.session) {
    res.status(401).json({ error: "unauthenticated", requestId: req.requestId });
    return;
  }
  if (!req.session.mfaPassed) {
    res.status(403).json({
      error: "mfa_required",
      message: "Second factor required to continue.",
      requestId: req.requestId,
    });
    return;
  }
  next();
}

/**
 * Org-wide MFA enforcement.
 *
 * When `organizations.require_mfa` is true, every member must have
 * enrolled in (and enabled) TOTP. Until they do, the only routes they
 * can call are the MFA-enrollment endpoints, `/auth/me`, and `/auth/logout`
 * — those are explicitly allow-listed in app.ts before this gate runs.
 */
export async function requireOrgMfaSatisfied(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) return next();
  try {
    const [org] = await db
      .select({ requireMfa: organizationsTable.requireMfa })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, req.user.organizationId));
    if (!org?.requireMfa) return next();
    const [mfa] = await db
      .select({ enabledAt: mfaSecretsTable.enabledAt })
      .from(mfaSecretsTable)
      .where(eq(mfaSecretsTable.userId, req.user.id));
    if (mfa?.enabledAt) return next();
    res.status(403).json({
      error: "mfa_enrollment_required",
      message: "Your organization requires two-factor authentication. Enroll in Settings → Security to continue.",
      requestId: req.requestId,
    });
  } catch {
    // Fail closed only on the gate failing wide open: if we cannot read
    // the policy, do not let the request through silently. Returning 503
    // surfaces the misconfiguration loudly without leaking detail.
    res.status(503).json({ error: "policy_check_failed", requestId: req.requestId });
  }
}
