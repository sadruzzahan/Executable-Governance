/**
 * Single source of truth for role-based access control.
 *
 * One matrix maps every action verb to the roles allowed to perform
 * it. The API enforces it via `requirePermission(action)` middleware
 * and the frontend reads the derived per-user capability list out of
 * `/auth/me` to gate or hide UI affordances.
 *
 * Roles in this codebase (see `users.role` enum):
 *   - reader   = "viewer"   in product copy: read published rules + decision outcomes only
 *   - editor   = "author"   in product copy: read everything in own org + create/update drafts
 *   - approver = "reviewer" in product copy: read everything in own org, no mutations
 *   - admin                                  : everything (publish, invite, security, org)
 *
 * Cross-org isolation is enforced separately at the resource-loader
 * level (load helpers return null for resources outside the caller's
 * org so the route returns 404, not 403). The matrix below answers
 * "can this role perform this action at all"; the loaders answer
 * "is this resource even visible to them".
 */
import type { userRoleEnum } from "./schema/users";

export type Role = (typeof userRoleEnum.enumValues)[number];

export const ALL_ROLES: readonly Role[] = ["reader", "editor", "approver", "admin"] as const;

export const ACTIONS = [
  "policy.read",
  "policy.read.draft",
  "policy.create",
  "policy.update",
  "policy.delete",
  "policy.publish",
  "policy.archive",

  "rule.read",
  "rule.read.draft",
  "rule.create",
  "rule.update",
  "rule.delete",
  "rule.publish",
  "rule.simulate",
  "rule.analyze",

  "decision.read",
  "decision.evaluate",

  "user.read",
  "user.invite",
  "user.update",
  "user.delete",

  "organization.read",
  "organization.create",
  "organization.update",
  "organization.delete",
  "organization.security",

  "analytics.read",
  "audit.read",
] as const;

export type Action = (typeof ACTIONS)[number];

const READER_ACTIONS: Action[] = [
  "policy.read",
  "rule.read",
  "decision.read",
];

const EDITOR_ACTIONS: Action[] = [
  ...READER_ACTIONS,
  "policy.read.draft",
  "policy.create",
  "policy.update",
  "policy.delete",
  "policy.archive",
  "rule.read.draft",
  "rule.create",
  "rule.update",
  "rule.delete",
  "rule.simulate",
  "rule.analyze",
  "decision.evaluate",
  "user.read",
  "organization.read",
  "analytics.read",
];

const APPROVER_ACTIONS: Action[] = [
  ...READER_ACTIONS,
  "policy.read.draft",
  "rule.read.draft",
  "rule.simulate",
  "rule.analyze",
  "decision.evaluate",
  "user.read",
  "organization.read",
  "analytics.read",
  "audit.read",
];

const ADMIN_ACTIONS: Action[] = [...ACTIONS];

const ROLE_MATRIX: Record<Role, ReadonlySet<Action>> = {
  reader: new Set(READER_ACTIONS),
  editor: new Set(EDITOR_ACTIONS),
  approver: new Set(APPROVER_ACTIONS),
  admin: new Set(ADMIN_ACTIONS),
};

export interface PermissionPrincipal {
  role: Role;
}

export function can(principal: PermissionPrincipal | null | undefined, action: Action): boolean {
  if (!principal) return false;
  return ROLE_MATRIX[principal.role].has(action);
}

export function capabilitiesFor(role: Role): Action[] {
  return [...ROLE_MATRIX[role]].sort();
}
