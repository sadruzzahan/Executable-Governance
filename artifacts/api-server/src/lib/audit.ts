/**
 * Audit log writer.
 *
 * Every mutating route, MFA action, and access denial calls this so the
 * audit table records actor, action, resource, and outcome. Writes are
 * fire-and-forget — a write failure never blocks the API response — but
 * are logged at warn level so a broken pipeline is visible.
 */
import type { Request } from "express";
import { db, auditLogTable } from "@workspace/db";
import { logger } from "./logger";

export type AuditResult = "success" | "denied" | "failure";

export interface AuditEntry {
  req?: Pick<Request, "user" | "ip" | "requestId" | "header"> | undefined;
  organizationId?: number | null;
  actorUserId?: number | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | number | null;
  result: AuditResult;
  metadata?: Record<string, unknown> | null;
}

export function auditWrite(entry: AuditEntry): void {
  const orgId =
    entry.organizationId !== undefined
      ? entry.organizationId
      : entry.req?.user?.organizationId ?? null;
  const actor =
    entry.actorUserId !== undefined
      ? entry.actorUserId
      : entry.req?.user?.id ?? null;
  const userAgent =
    typeof entry.req?.header === "function" ? entry.req.header("user-agent") ?? null : null;
  db.insert(auditLogTable)
    .values({
      organizationId: orgId,
      actorUserId: actor,
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId != null ? String(entry.resourceId) : null,
      result: entry.result,
      requestId: entry.req?.requestId ?? null,
      ip: entry.req?.ip ?? null,
      userAgent,
      metadata: entry.metadata ?? null,
    })
    .catch((err) => {
      logger.warn({ err, action: entry.action }, "audit_write_failed");
    });
}
