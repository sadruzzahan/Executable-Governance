import { send400 } from "../lib/validation";
import { Router, type IRouter } from "express";
import { eq, and, sql, desc, gte, inArray } from "drizzle-orm";
import {
  db,
  organizationsTable,
  policiesTable,
  rulesTable,
  usersTable,
  decisionsTable,
} from "@workspace/db";
import {
  GetAnalyticsSummaryQueryParams,
  GetRecentActivityQueryParams,
  GetPolicyBreakdownQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ─── Summary ──────────────────────────────────────────────────────────────────

router.get("/analytics/summary", async (req, res): Promise<void> => {
  const query = GetAnalyticsSummaryQueryParams.safeParse(req.query);
  if (!query.success) { send400(res, req, query.error); return; }
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

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const decisionCond = orgId != null
    ? and(gte(decisionsTable.createdAt, thirtyDaysAgo), eq(decisionsTable.organizationId, orgId))
    : gte(decisionsTable.createdAt, thirtyDaysAgo);
  const [decisionStats] = await db.select({
    total: sql<number>`cast(count(*) as int)`,
    approvedCount: sql<number>`cast(coalesce(sum(case when ${decisionsTable.outcome} = 'approved' then 1 else 0 end), 0) as int)`,
    exceptionCount: sql<number>`cast(coalesce(sum(case when ${decisionsTable.outcome} in ('needs_review', 'escalated') then 1 else 0 end), 0) as int)`,
  }).from(decisionsTable).where(decisionCond);

  const decisionsLast30d = decisionStats.total;
  const approvalRate = decisionsLast30d > 0 ? Math.round((decisionStats.approvedCount / decisionsLast30d) * 100) : 0;
  const exceptionRate = decisionsLast30d > 0 ? Math.round((decisionStats.exceptionCount / decisionsLast30d) * 100) : 0;

  res.json({
    totalOrganizations: orgCount.c,
    totalPolicies: policyTotals.total,
    publishedPolicies: policyTotals.published,
    draftPolicies: policyTotals.draft,
    totalRules: ruleTotals.total,
    publishedRules: ruleTotals.published,
    draftRules: ruleTotals.draft,
    totalUsers: userCount.c,
    decisionsLast30d,
    approvalRate,
    exceptionRate,
  });
});

// ─── Decision Volume ──────────────────────────────────────────────────────────

router.get("/analytics/decision-volume", async (req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT
      to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
      outcome,
      CAST(COUNT(*) AS INT) AS cnt
    FROM decisions
    WHERE created_at >= now() - INTERVAL '30 days'
    GROUP BY date_trunc('day', created_at AT TIME ZONE 'UTC'), outcome
    ORDER BY date_trunc('day', created_at AT TIME ZONE 'UTC')
  `);

  type DayAccum = { approved: number; denied: number; escalated: number; needs_review: number };
  const dayMap: Record<string, DayAccum> = {};
  for (const row of result.rows) {
    const d = row.day as string;
    const outcome = row.outcome as string;
    const cnt = row.cnt as number;
    if (!dayMap[d]) dayMap[d] = { approved: 0, denied: 0, escalated: 0, needs_review: 0 };
    (dayMap[d] as Record<string, number>)[outcome] = cnt;
  }

  const days = Object.entries(dayMap).map(([date, c]) => ({
    date,
    approved: c.approved,
    denied: c.denied,
    escalated: c.escalated,
    needs_review: c.needs_review,
    total: c.approved + c.denied + c.escalated + c.needs_review,
  }));

  res.json({ days, total: days.reduce((s, d) => s + d.total, 0) });
});

// ─── Top Rules ────────────────────────────────────────────────────────────────

router.get("/analytics/top-rules", async (req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT
      CAST(elem->>'ruleId' AS INT) AS rule_id,
      elem->>'ruleName' AS rule_name,
      CAST(COUNT(*) AS INT) AS eval_count,
      CAST(COUNT(*) FILTER (WHERE (elem->>'matched')::boolean = true) AS INT) AS fire_count,
      CAST(COUNT(*) FILTER (WHERE (elem->>'matched')::boolean = true AND d.outcome = 'approved') AS INT) AS approved_count,
      CAST(COUNT(*) FILTER (WHERE (elem->>'matched')::boolean = true AND d.outcome = 'denied') AS INT) AS denied_count,
      CAST(COUNT(*) FILTER (WHERE (elem->>'matched')::boolean = true AND d.outcome = 'escalated') AS INT) AS escalated_count,
      CAST(COUNT(*) FILTER (WHERE (elem->>'matched')::boolean = true AND d.outcome = 'needs_review') AS INT) AS needs_review_count
    FROM decisions d
    CROSS JOIN LATERAL jsonb_array_elements(d.rules_applied_json) AS elem
    WHERE d.created_at >= now() - INTERVAL '30 days'
      AND jsonb_typeof(d.rules_applied_json) = 'array'
    GROUP BY CAST(elem->>'ruleId' AS INT), elem->>'ruleName'
    ORDER BY fire_count DESC, eval_count DESC
    LIMIT 5
  `);

  const ruleIds = result.rows.map((r) => r.rule_id as number).filter((id) => id != null && id > 0);
  const policyMap: Record<number, { policyId: number; policyName: string }> = {};

  if (ruleIds.length > 0) {
    const joined = await db
      .select({ id: rulesTable.id, policyId: rulesTable.policyId, policyName: policiesTable.name })
      .from(rulesTable)
      .leftJoin(policiesTable, eq(rulesTable.policyId, policiesTable.id))
      .where(inArray(rulesTable.id, ruleIds));
    for (const r of joined) policyMap[r.id] = { policyId: r.policyId, policyName: r.policyName ?? "Unknown" };
  }

  const rules = result.rows
    .filter((r) => r.rule_id != null)
    .map((r) => ({
      ruleId: r.rule_id as number,
      ruleName: r.rule_name as string,
      policyId: policyMap[r.rule_id as number]?.policyId ?? 0,
      policyName: policyMap[r.rule_id as number]?.policyName ?? "Unknown",
      triggerCount: r.fire_count as number,
      evalCount: r.eval_count as number,
      approvedCount: r.approved_count as number,
      deniedCount: r.denied_count as number,
      escalatedCount: r.escalated_count as number,
      needsReviewCount: r.needs_review_count as number,
    }));

  res.json({ rules });
});

// ─── Coverage Gaps ────────────────────────────────────────────────────────────

router.get("/analytics/coverage-gaps", async (req, res): Promise<void> => {
  const policyRuleCounts = await db
    .select({
      policyId: policiesTable.id,
      policyName: policiesTable.name,
      organizationName: organizationsTable.name,
      publishedRuleCount: sql<number>`cast(count(case when ${rulesTable.status} = 'published' then 1 end) as int)`,
    })
    .from(policiesTable)
    .leftJoin(organizationsTable, eq(policiesTable.organizationId, organizationsTable.id))
    .leftJoin(rulesTable, eq(rulesTable.policyId, policiesTable.id))
    .where(eq(policiesTable.status, "published"))
    .groupBy(policiesTable.id, policiesTable.name, organizationsTable.name);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const needsReviewRows = await db
    .select({
      policyId: decisionsTable.policyId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(decisionsTable)
    .where(and(eq(decisionsTable.outcome, "needs_review"), gte(decisionsTable.createdAt, sevenDaysAgo)))
    .groupBy(decisionsTable.policyId);

  const needsReviewMap: Record<number, number> = {};
  for (const r of needsReviewRows) {
    if (r.policyId != null) needsReviewMap[r.policyId] = r.count;
  }

  const gaps = policyRuleCounts
    .map((p) => {
      const nr7d = needsReviewMap[p.policyId] ?? 0;
      const fewRules = p.publishedRuleCount < 3;
      const highExceptions = nr7d >= 3;
      return { p, nr7d, fewRules, highExceptions };
    })
    .filter(({ fewRules, highExceptions }) => fewRules || highExceptions)
    .map(({ p, nr7d, fewRules, highExceptions }) => ({
      policyId: p.policyId,
      policyName: p.policyName,
      organizationName: p.organizationName ?? "Unknown",
      publishedRuleCount: p.publishedRuleCount,
      needsReviewCount7d: nr7d,
      gapReason: fewRules && highExceptions ? "both" : fewRules ? "few_rules" : "high_exceptions",
    }));

  res.json({ gaps });
});

// ─── Rule Health ──────────────────────────────────────────────────────────────

router.get("/analytics/rule-health", async (req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT
      r.id AS rule_id,
      r.name AS rule_name,
      r.policy_id,
      p.name AS policy_name,
      CAST(COALESCE(
        (SELECT COUNT(*) FROM jsonb_array_elements(r.resolved_ambiguities) ea
         WHERE (ea->>'resolved')::boolean = false), 0
      ) AS INT) AS unresolved_ambiguities,
      CAST(COALESCE(
        (SELECT COUNT(*) FROM jsonb_array_elements(r.resolved_edge_cases) ee
         WHERE (ee->>'resolved')::boolean = false), 0
      ) AS INT) AS unresolved_edge_cases,
      CAST(COALESCE(jsonb_array_length(r.resolved_ambiguities), 0) AS INT) AS total_ambiguities,
      CAST(COALESCE(jsonb_array_length(r.resolved_edge_cases), 0) AS INT) AS total_edge_cases,
      CAST(COALESCE(
        (SELECT COUNT(*)
         FROM decisions d2
         CROSS JOIN LATERAL jsonb_array_elements(d2.rules_applied_json) AS elem2
         WHERE (elem2->>'ruleId')::int = r.id
           AND d2.outcome = 'needs_review'
           AND d2.created_at >= now() - INTERVAL '30 days'
           AND jsonb_typeof(d2.rules_applied_json) = 'array'), 0
      ) AS INT) AS conflict_signals,
      CAST((SELECT COUNT(*) FROM rule_versions rv WHERE rv.rule_id = r.id) AS INT) AS human_overrides
    FROM rules r
    LEFT JOIN policies p ON r.policy_id = p.id
    WHERE r.status = 'published'
    ORDER BY (
      COALESCE((SELECT COUNT(*) FROM jsonb_array_elements(r.resolved_ambiguities) ea WHERE (ea->>'resolved')::boolean = false), 0) +
      COALESCE((SELECT COUNT(*) FROM jsonb_array_elements(r.resolved_edge_cases) ee WHERE (ee->>'resolved')::boolean = false), 0) * 2 +
      COALESCE((SELECT COUNT(*) FROM decisions d3
        CROSS JOIN LATERAL jsonb_array_elements(d3.rules_applied_json) AS elem3
        WHERE (elem3->>'ruleId')::int = r.id
          AND d3.outcome = 'needs_review'
          AND d3.created_at >= now() - INTERVAL '30 days'
          AND jsonb_typeof(d3.rules_applied_json) = 'array'), 0)
    ) DESC
    LIMIT 10
  `);

  const rules = result.rows.map((r) => {
    const ua = r.unresolved_ambiguities as number;
    const ue = r.unresolved_edge_cases as number;
    const cs = r.conflict_signals as number;
    const ho = r.human_overrides as number;
    return {
      ruleId: r.rule_id as number,
      ruleName: r.rule_name as string,
      policyId: r.policy_id as number,
      policyName: (r.policy_name as string | null) ?? "Unknown",
      unresolvedAmbiguities: ua,
      unresolvedEdgeCases: ue,
      totalAmbiguities: r.total_ambiguities as number,
      totalEdgeCases: r.total_edge_cases as number,
      conflictSignals: cs,
      humanOverrides: ho,
      healthScore: ua + ue * 2 + cs,
    };
  });

  res.json({ rules });
});

// ─── Recent Activity ──────────────────────────────────────────────────────────

router.get("/analytics/recent-activity", async (req, res): Promise<void> => {
  const query = GetRecentActivityQueryParams.safeParse(req.query);
  if (!query.success) { send400(res, req, query.error); return; }
  const limit = query.data.limit ?? 20;
  const orgId = query.data.organizationId;

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
    id: number; type: string; entityId: number; entityName: string;
    entityType: string; organizationName: string; policyName: string | null; createdAt: Date;
  };
  const items: Activity[] = [];

  for (const r of ruleRows) {
    const isCreated = r.createdAt.getTime() === r.updatedAt.getTime() || r.version === 1;
    items.push({
      id: r.id,
      type: r.status === "published" ? "rule_published" : isCreated ? "rule_created" : "rule_updated",
      entityId: r.id, entityName: r.entityName, entityType: "rule",
      organizationName: r.organizationName ?? "Unknown", policyName: r.policyName, createdAt: r.updatedAt,
    });
  }
  for (const p of policyRows) {
    const isCreated = p.createdAt.getTime() === p.updatedAt.getTime();
    items.push({
      id: p.id,
      type: p.status === "published" ? "policy_published" : p.status === "archived" ? "policy_archived" : isCreated ? "policy_created" : "policy_updated",
      entityId: p.id, entityName: p.entityName, entityType: "policy",
      organizationName: p.organizationName ?? "Unknown", policyName: null, createdAt: p.updatedAt,
    });
  }

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  res.json(items.slice(0, limit));
});

// ─── Policy Breakdown ─────────────────────────────────────────────────────────

router.get("/analytics/policy-breakdown", async (req, res): Promise<void> => {
  const query = GetPolicyBreakdownQueryParams.safeParse(req.query);
  if (!query.success) { send400(res, req, query.error); return; }
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

export default router;
