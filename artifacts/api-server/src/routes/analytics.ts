import { Router, type IRouter } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import { db, organizationsTable, policiesTable, rulesTable, usersTable, ruleVersionsTable } from "@workspace/db";
import {
  GetAnalyticsSummaryQueryParams,
  GetRecentActivityQueryParams,
  GetPolicyBreakdownQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/analytics/summary", async (req, res): Promise<void> => {
  const query = GetAnalyticsSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const orgId = query.data.organizationId;

  const [orgCount] = await db.select({ c: sql<number>`cast(count(*) as int)` }).from(organizationsTable);

  const policyConditions = orgId != null ? [eq(policiesTable.organizationId, orgId)] : [];
  const [policyTotals] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      published: sql<number>`cast(coalesce(sum(case when ${policiesTable.status} = 'published' then 1 else 0 end), 0) as int)`,
      draft: sql<number>`cast(coalesce(sum(case when ${policiesTable.status} = 'draft' then 1 else 0 end), 0) as int)`,
    })
    .from(policiesTable)
    .where(policyConditions.length > 0 ? and(...policyConditions) : undefined);

  const ruleQuery = orgId != null
    ? db.select({
        total: sql<number>`cast(count(*) as int)`,
        published: sql<number>`cast(coalesce(sum(case when ${rulesTable.status} = 'published' then 1 else 0 end), 0) as int)`,
        draft: sql<number>`cast(coalesce(sum(case when ${rulesTable.status} = 'draft' then 1 else 0 end), 0) as int)`,
      }).from(rulesTable).leftJoin(policiesTable, eq(rulesTable.policyId, policiesTable.id)).where(eq(policiesTable.organizationId, orgId))
    : db.select({
        total: sql<number>`cast(count(*) as int)`,
        published: sql<number>`cast(coalesce(sum(case when ${rulesTable.status} = 'published' then 1 else 0 end), 0) as int)`,
        draft: sql<number>`cast(coalesce(sum(case when ${rulesTable.status} = 'draft' then 1 else 0 end), 0) as int)`,
      }).from(rulesTable);
  const [ruleTotals] = await ruleQuery;

  const userConditions = orgId != null ? [eq(usersTable.organizationId, orgId)] : [];
  const [userCount] = await db
    .select({ c: sql<number>`cast(count(*) as int)` })
    .from(usersTable)
    .where(userConditions.length > 0 ? and(...userConditions) : undefined);

  res.json({
    totalOrganizations: orgCount.c,
    totalPolicies: policyTotals.total,
    publishedPolicies: policyTotals.published,
    draftPolicies: policyTotals.draft,
    totalRules: ruleTotals.total,
    publishedRules: ruleTotals.published,
    draftRules: ruleTotals.draft,
    totalUsers: userCount.c,
  });
});

router.get("/analytics/recent-activity", async (req, res): Promise<void> => {
  const query = GetRecentActivityQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const limit = query.data.limit ?? 20;
  const orgId = query.data.organizationId;

  // Recent rules: union of created and version updates
  const ruleRows = await db
    .select({
      id: rulesTable.id,
      entityName: rulesTable.name,
      organizationName: organizationsTable.name,
      policyName: policiesTable.name,
      status: rulesTable.status,
      createdAt: rulesTable.createdAt,
      updatedAt: rulesTable.updatedAt,
      version: rulesTable.version,
    })
    .from(rulesTable)
    .leftJoin(policiesTable, eq(rulesTable.policyId, policiesTable.id))
    .leftJoin(organizationsTable, eq(policiesTable.organizationId, organizationsTable.id))
    .where(orgId != null ? eq(policiesTable.organizationId, orgId) : undefined)
    .orderBy(desc(rulesTable.updatedAt))
    .limit(limit);

  const policyRows = await db
    .select({
      id: policiesTable.id,
      entityName: policiesTable.name,
      organizationName: organizationsTable.name,
      status: policiesTable.status,
      createdAt: policiesTable.createdAt,
      updatedAt: policiesTable.updatedAt,
    })
    .from(policiesTable)
    .leftJoin(organizationsTable, eq(policiesTable.organizationId, organizationsTable.id))
    .where(orgId != null ? eq(policiesTable.organizationId, orgId) : undefined)
    .orderBy(desc(policiesTable.updatedAt))
    .limit(limit);

  type Activity = {
    id: number;
    type: string;
    entityId: number;
    entityName: string;
    entityType: string;
    organizationName: string;
    policyName: string | null;
    createdAt: Date;
  };

  const items: Activity[] = [];

  for (const r of ruleRows) {
    const isCreated = r.createdAt.getTime() === r.updatedAt.getTime() || r.version === 1;
    items.push({
      id: r.id,
      type: r.status === "published" ? "rule_published" : isCreated ? "rule_created" : "rule_updated",
      entityId: r.id,
      entityName: r.entityName,
      entityType: "rule",
      organizationName: r.organizationName ?? "Unknown",
      policyName: r.policyName,
      createdAt: r.updatedAt,
    });
  }

  for (const p of policyRows) {
    const isCreated = p.createdAt.getTime() === p.updatedAt.getTime();
    items.push({
      id: p.id,
      type: p.status === "published" ? "policy_published" : p.status === "archived" ? "policy_archived" : isCreated ? "policy_created" : "policy_updated",
      entityId: p.id,
      entityName: p.entityName,
      entityType: "policy",
      organizationName: p.organizationName ?? "Unknown",
      policyName: null,
      createdAt: p.updatedAt,
    });
  }

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  res.json(items.slice(0, limit));
});

router.get("/analytics/policy-breakdown", async (req, res): Promise<void> => {
  const query = GetPolicyBreakdownQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const orgId = query.data.organizationId;
  const conditions = orgId != null ? [eq(policiesTable.organizationId, orgId)] : [];

  const [totals] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      draft: sql<number>`cast(coalesce(sum(case when ${policiesTable.status} = 'draft' then 1 else 0 end), 0) as int)`,
      published: sql<number>`cast(coalesce(sum(case when ${policiesTable.status} = 'published' then 1 else 0 end), 0) as int)`,
      archived: sql<number>`cast(coalesce(sum(case when ${policiesTable.status} = 'archived' then 1 else 0 end), 0) as int)`,
    })
    .from(policiesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const byDomain = await db
    .select({
      domain: policiesTable.domain,
      count: sql<number>`cast(count(*) as int)`,
      publishedCount: sql<number>`cast(coalesce(sum(case when ${policiesTable.status} = 'published' then 1 else 0 end), 0) as int)`,
    })
    .from(policiesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(policiesTable.domain)
    .orderBy(desc(sql`count(*)`));

  res.json({
    totalPolicies: totals.total,
    byStatus: { draft: totals.draft, published: totals.published, archived: totals.archived },
    byDomain,
  });
});

// Reference imports to keep TypeScript happy if any are unused above
void ruleVersionsTable;

export default router;
