/**
 * Role-based access control middleware.
 *
 * `requirePermission(action)` consults the shared permission matrix
 * from @workspace/db. If the caller's role doesn't carry the action,
 * the request is denied with a consistent 403 shape and an audit-log
 * entry recording the denial. Cross-org isolation (404 vs 403) is the
 * job of the per-resource loaders in lib/orgScope, NOT this middleware
 * — RBAC only answers "is this role allowed to do X at all".
 */
import type { NextFunction, Request, Response } from "express";
import { can, type Action } from "@workspace/db";
import { auditWrite } from "../lib/audit";

export function requirePermission(action: Action) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res
        .status(401)
        .json({ error: "unauthenticated", message: "Sign in required.", requestId: req.requestId });
      return;
    }
    if (!can(req.user, action)) {
      auditWrite({
        req,
        action,
        resourceType: null,
        resourceId: null,
        result: "denied",
        metadata: { reason: "rbac_denied", role: req.user.role, path: req.path },
      });
      res.status(403).json({
        error: "forbidden",
        action,
        message: "Your role doesn't permit this action.",
        requestId: req.requestId,
      });
      return;
    }
    next();
  };
}
