/**
 * Resource loaders that enforce cross-org isolation by *not finding*
 * resources that belong to a different organization than the caller.
 *
 * Routes call these helpers and return 404 when null comes back. That
 * keeps "this resource doesn't exist for you" indistinguishable from
 * "this resource does not exist", which prevents enumeration attacks
 * across tenants.
 */
import { eq } from "drizzle-orm";
import {
  db,
  policiesTable,
  rulesTable,
  decisionsTable,
  usersTable,
  organizationsTable,
} from "@workspace/db";

export async function loadOrgScopedPolicy(
  policyId: number,
  callerOrgId: number,
) {
  const [row] = await db
    .select()
    .from(policiesTable)
    .where(eq(policiesTable.id, policyId));
  if (!row || row.organizationId !== callerOrgId) return null;
  return row;
}

export async function loadOrgScopedRule(
  ruleId: number,
  callerOrgId: number,
) {
  const [row] = await db
    .select({
      id: rulesTable.id,
      policyId: rulesTable.policyId,
      organizationId: policiesTable.organizationId,
      name: rulesTable.name,
      status: rulesTable.status,
    })
    .from(rulesTable)
    .leftJoin(policiesTable, eq(rulesTable.policyId, policiesTable.id))
    .where(eq(rulesTable.id, ruleId));
  if (!row || row.organizationId !== callerOrgId) return null;
  return row;
}

export async function loadOrgScopedDecision(
  decisionId: number,
  callerOrgId: number,
) {
  const [row] = await db
    .select()
    .from(decisionsTable)
    .where(eq(decisionsTable.id, decisionId));
  if (!row || row.organizationId !== callerOrgId) return null;
  return row;
}

export async function loadOrgScopedUser(
  userId: number,
  callerOrgId: number,
) {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!row || row.organizationId !== callerOrgId) return null;
  return row;
}

export async function loadOrgScopedOrganization(
  orgId: number,
  callerOrgId: number,
) {
  if (orgId !== callerOrgId) return null;
  const [row] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId));
  return row ?? null;
}
