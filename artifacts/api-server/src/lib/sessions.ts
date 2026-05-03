/**
 * Server-side session helpers.
 *
 * The browser only ever holds an opaque token (in an httpOnly cookie);
 * the database stores the sha256 of that token plus the metadata we
 * surface in the "active sessions" UI. Looking up sessions by token
 * hash means a database leak cannot be replayed as a live login.
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  db,
  userSessionsTable,
  usersTable,
  type User,
  type UserSession,
} from "@workspace/db";
import type { Request, Response } from "express";
import { hashToken } from "./tokens";
import { getEnv } from "./env";

export const SESSION_COOKIE = "eg_session";
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface CreateSessionOptions {
  userId: number;
  ip?: string;
  userAgent?: string;
  mfaPassed?: boolean;
}

export async function createSession(opts: CreateSessionOptions): Promise<{
  session: UserSession;
  token: string;
}> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const ua = opts.userAgent?.slice(0, 500);
  const [session] = await db
    .insert(userSessionsTable)
    .values({
      userId: opts.userId,
      tokenHash,
      ip: opts.ip,
      userAgent: ua,
      deviceLabel: deriveDeviceLabel(ua),
      mfaPassed: opts.mfaPassed ?? false,
      expiresAt,
    })
    .returning();
  return { session, token };
}

export async function loadSessionByToken(token: string): Promise<{
  session: UserSession;
  user: User;
} | null> {
  const tokenHash = hashToken(token);
  const now = new Date();
  const rows = await db
    .select({ session: userSessionsTable, user: usersTable })
    .from(userSessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, userSessionsTable.userId))
    .where(
      and(
        eq(userSessionsTable.tokenHash, tokenHash),
        isNull(userSessionsTable.revokedAt),
        gt(userSessionsTable.expiresAt, now),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0];
}

export async function touchSession(sessionId: number): Promise<void> {
  await db
    .update(userSessionsTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(userSessionsTable.id, sessionId));
}

export async function revokeSession(
  sessionId: number,
  userId: number,
): Promise<boolean> {
  const result = await db
    .update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(userSessionsTable.id, sessionId),
        eq(userSessionsTable.userId, userId),
      ),
    )
    .returning({ id: userSessionsTable.id });
  return result.length > 0;
}

export async function revokeAllOtherSessions(
  userId: number,
  keepSessionId: number,
): Promise<number> {
  const result = await db
    .update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(userSessionsTable.userId, userId),
        isNull(userSessionsTable.revokedAt),
      ),
    )
    .returning({ id: userSessionsTable.id });
  // Caller can't filter "not equal" cleanly with our drizzle slice; do it post-hoc.
  // Re-mark the kept session as not revoked.
  await db
    .update(userSessionsTable)
    .set({ revokedAt: null })
    .where(eq(userSessionsTable.id, keepSessionId));
  return Math.max(0, result.length - 1);
}

export async function revokeAllSessions(userId: number): Promise<void> {
  await db
    .update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(userSessionsTable.userId, userId),
        isNull(userSessionsTable.revokedAt),
      ),
    );
}

export function setSessionCookie(res: Response, token: string): void {
  const env = getEnv();
  const isProd = env.NODE_ENV === "production";
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.appendHeader(
    "Set-Cookie",
    [
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      isProd ? "Secure" : "",
      "SameSite=Lax",
      `Max-Age=${maxAge}`,
    ]
      .filter(Boolean)
      .join("; "),
  );
}

export function clearSessionCookie(res: Response): void {
  res.appendHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

export function readSessionCookie(req: Request): string | null {
  const header = req.header("cookie") ?? "";
  const m = header.match(/(?:^|;\s*)eg_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function deriveDeviceLabel(ua?: string): string {
  if (!ua) return "Unknown device";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS device";
  if (/Android/.test(ua)) return "Android device";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux";
  return "Browser";
}
