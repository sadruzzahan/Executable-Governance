/**
 * Outbound email sink.
 *
 * Real transactional email is a downstream task; until that lands every
 * outbound message is appended to the `email_outbox` table and logged
 * so flows are traceable end-to-end (and dev users can copy the link
 * out of the table). The `sendEmail` interface is intentionally narrow
 * so swapping in Resend / Postmark is a single-file change.
 */
import { db, emailOutboxTable } from "@workspace/db";
import { logger } from "./logger";

export type EmailKind =
  | "password_reset"
  | "email_verification"
  | "email_change_verification"
  | "mfa_enabled"
  | "password_changed"
  | "session_revoked"
  | "account_deleted";

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  kind: EmailKind;
}

export async function sendEmail(msg: OutboundEmail): Promise<void> {
  await db.insert(emailOutboxTable).values({
    toEmail: msg.to,
    subject: msg.subject,
    body: msg.body,
    kind: msg.kind,
  });
  logger.info(
    { to: msg.to, kind: msg.kind, subject: msg.subject },
    "outbound_email_queued",
  );
}

/**
 * Build the absolute URL the email body should link to. `BASE_URL` is
 * resolved from the request when available, otherwise from REPLIT_DEV_DOMAIN.
 */
export function appLink(path: string): string {
  const base =
    process.env.APP_BASE_URL ??
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://localhost:8080");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base.replace(/\/+$/, "")}${cleanPath}`;
}
