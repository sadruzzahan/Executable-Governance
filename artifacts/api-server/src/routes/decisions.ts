import { Router, type IRouter } from "express";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { db, rulesTable, policiesTable, decisionsTable, organizationsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  EvaluateDecisionParams,
  ListDecisionsQueryParams,
  GetDecisionParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

interface CompiledCondition {
  field: string;
  operator: string;
  value: unknown;
  kind: string;
}

interface RuleEvalResult {
  ruleId: number;
  ruleName: string;
  priority: number;
  outcome: string;
  matched: boolean;
  matchScore: number;
  conditions: Array<{
    field: string;
    operator: string;
    ruleValue: unknown;
    contextValue: unknown;
    passed: boolean;
  }>;
}

function compileConditions(structuredRepresentation: unknown): CompiledCondition[] {
  if (!structuredRepresentation || typeof structuredRepresentation !== "object") return [];
  const obj = structuredRepresentation as Record<string, unknown>;

  if (typeof obj.field === "string" && obj.operator !== undefined) {
    return [{
      field: obj.field,
      operator: String(obj.operator),
      value: obj.value,
      kind: typeof obj.kind === "string" ? obj.kind : "threshold",
    }];
  }

  if (Array.isArray(obj.conditions)) {
    return (obj.conditions as Record<string, unknown>[])
      .filter((c) => typeof c.field === "string")
      .map((c) => ({
        field: String(c.field),
        operator: String(c.operator ?? "="),
        value: c.value,
        kind: String(c.kind ?? "threshold"),
      }));
  }

  return [];
}

function evaluateCondition(
  condition: CompiledCondition,
  context: Record<string, unknown>,
): { passed: boolean; contextValue: unknown } {
  const contextValue = context[condition.field];
  if (contextValue === undefined) return { passed: false, contextValue: undefined };

  const numCtx = typeof contextValue === "number" ? contextValue : parseFloat(String(contextValue));
  const numRule = typeof condition.value === "number" ? condition.value : parseFloat(String(condition.value));
  const op = condition.operator.trim().toLowerCase().replace(/\s+/g, "");

  if (!isNaN(numCtx) && !isNaN(numRule)) {
    let passed: boolean;
    switch (op) {
      case "<": case "lt": passed = numCtx < numRule; break;
      case "<=": case "lte": case "le": passed = numCtx <= numRule; break;
      case ">": case "gt": passed = numCtx > numRule; break;
      case ">=": case "gte": case "ge": passed = numCtx >= numRule; break;
      case "!=": case "<>": case "ne": passed = numCtx !== numRule; break;
      default: passed = numCtx === numRule;
    }
    return { passed, contextValue };
  }

  const strCtx = String(contextValue).toLowerCase();
  const strRule = String(condition.value).toLowerCase();
  const passed = op === "!=" || op === "ne" ? strCtx !== strRule : strCtx === strRule;
  return { passed, contextValue };
}

function evaluateRule(
  rule: { id: number; name: string; priority: number; outcome: string; compiledConditions: unknown },
  context: Record<string, unknown>,
): RuleEvalResult {
  const conditions = compileConditions(rule.compiledConditions) || compileConditions(rule as unknown as Record<string, unknown>);

  if (conditions.length === 0) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      priority: rule.priority,
      outcome: rule.outcome,
      matched: false,
      matchScore: 0,
      conditions: [],
    };
  }

  const evaluated = conditions.map((c) => {
    const { passed, contextValue } = evaluateCondition(c, context);
    return {
      field: c.field,
      operator: c.operator,
      ruleValue: c.value,
      contextValue,
      passed,
    };
  });

  const passed = evaluated.filter((e) => e.passed).length;
  const present = evaluated.filter((e) => e.contextValue !== undefined).length;
  const matched = evaluated.every((e) => e.passed);
  const matchScore = matched ? 1.0 : (present * 0.3 + passed * 0.7) / conditions.length;

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    priority: rule.priority,
    outcome: rule.outcome,
    matched,
    matchScore,
    conditions: evaluated,
  };
}

async function generateExplanation(
  outcome: string,
  rulesApplied: RuleEvalResult[],
  context: Record<string, unknown>,
  actor: string,
  action: string,
): Promise<string> {
  const matchedRule = rulesApplied.find((r) => r.matched);
  const rulesSummary = rulesApplied
    .slice(0, 5)
    .map((r) => `- Rule "${r.ruleName}" (priority ${r.priority}): ${r.matched ? "MATCHED → " + r.outcome.toUpperCase() : "not matched"}`
      + (r.conditions.length > 0
        ? "\n  Conditions: " + r.conditions.map((c) =>
            `${c.field} ${c.operator} ${c.ruleValue} (context: ${c.contextValue ?? "not provided"}) → ${c.passed ? "pass" : "FAIL"}`
          ).join(", ")
        : "")
    ).join("\n");

  const prompt = `You are a compliance decision explainer. Summarize this governance decision in 2-4 plain-language sentences.

Actor: ${actor}
Action: ${action}
Context: ${JSON.stringify(context, null, 2)}
Decision: ${outcome.toUpperCase()}
${matchedRule ? `Matched rule: "${matchedRule.ruleName}" → ${matchedRule.outcome}` : "No rule fully matched."}

Rules evaluated:
${rulesSummary}

Write a clear, specific explanation referencing the exact values and rule names. Be concise.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 512,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    });
    return response.choices[0]?.message?.content ?? `Decision: ${outcome.toUpperCase()} — no explanation available.`;
  } catch {
    return `Decision: ${outcome.toUpperCase()}. ${matchedRule ? `Matched rule: "${matchedRule.ruleName}".` : "No rule matched — escalated for review."}`;
  }
}

router.post("/decisions/evaluate", async (req, res): Promise<void> => {
  const body = EvaluateDecisionParams.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { policyId, actor, action, context, scenario } = body.data;
  const evalContext: Record<string, unknown> = context ?? {};

  const [policy] = await db
    .select({
      id: policiesTable.id,
      organizationId: policiesTable.organizationId,
      name: policiesTable.name,
      status: policiesTable.status,
    })
    .from(policiesTable)
    .where(eq(policiesTable.id, policyId));

  if (!policy) { res.status(404).json({ error: "Policy not found" }); return; }

  if (policy.status !== "published") {
    res.status(422).json({ error: "Policy is not published — only published policies can be evaluated" });
    return;
  }

  const rules = await db
    .select({
      id: rulesTable.id,
      name: rulesTable.name,
      priority: rulesTable.priority,
      outcome: rulesTable.outcome,
      structuredRepresentation: rulesTable.structuredRepresentation,
      compiledConditions: rulesTable.compiledConditions,
    })
    .from(rulesTable)
    .where(and(eq(rulesTable.policyId, policyId), eq(rulesTable.status, "published")))
    .orderBy(rulesTable.priority);

  if (rules.length === 0) {
    res.status(422).json({ error: "Policy has no published rules to evaluate against" });
    return;
  }

  const evalResults: RuleEvalResult[] = rules.map((rule) => {
    const compiled = rule.compiledConditions ?? rule.structuredRepresentation;
    return evaluateRule({ ...rule, compiledConditions: compiled }, evalContext);
  });

  const matchedRule = evalResults.find((r) => r.matched);

  let outcome: "approved" | "denied" | "escalated" | "needs_review";
  let confidence: number;

  if (matchedRule) {
    outcome = matchedRule.outcome as typeof outcome;
    confidence = 100;
  } else {
    outcome = "needs_review";
    const bestScore = Math.max(...evalResults.map((r) => r.matchScore), 0);
    confidence = Math.round(bestScore * 60);
  }

  const auditRules = matchedRule
    ? evalResults
    : [...evalResults].sort((a, b) => b.matchScore - a.matchScore).slice(0, 3);

  const explanation = await generateExplanation(outcome, evalResults, evalContext, actor, action);

  const [saved] = await db.insert(decisionsTable).values({
    organizationId: policy.organizationId,
    policyId,
    actor,
    action,
    contextJson: evalContext,
    outcome,
    rulesAppliedJson: auditRules,
    explanation,
    confidence,
    scenario: scenario ?? null,
  }).returning();

  res.json({
    id: saved.id,
    decision: outcome,
    reason: explanation,
    rulesApplied: auditRules.map((r) => ({
      ruleId: r.ruleId,
      name: r.ruleName,
      priority: r.priority,
      outcome: r.outcome,
      matched: r.matched,
    })),
    confidence,
    explanation,
    policyId,
    policyName: policy.name,
    createdAt: saved.createdAt,
  });
});

router.get("/decisions", async (req, res): Promise<void> => {
  const query = ListDecisionsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const { policyId, outcome, actor, dateFrom, dateTo, page, limit } = query.data;
  const pageNum = page ?? 1;
  const pageSize = limit ?? 25;
  const offset = (pageNum - 1) * pageSize;

  const conditions = [];
  if (policyId != null) conditions.push(eq(decisionsTable.policyId, policyId));
  if (outcome != null) conditions.push(eq(decisionsTable.outcome, outcome as "approved" | "denied" | "escalated" | "needs_review"));
  if (actor != null) conditions.push(eq(decisionsTable.actor, actor));
  if (dateFrom != null) conditions.push(gte(decisionsTable.createdAt, new Date(dateFrom)));
  if (dateTo != null) conditions.push(lte(decisionsTable.createdAt, new Date(dateTo)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: decisionsTable.id,
        organizationId: decisionsTable.organizationId,
        policyId: decisionsTable.policyId,
        actor: decisionsTable.actor,
        action: decisionsTable.action,
        outcome: decisionsTable.outcome,
        confidence: decisionsTable.confidence,
        scenario: decisionsTable.scenario,
        createdAt: decisionsTable.createdAt,
        policyName: policiesTable.name,
        organizationName: organizationsTable.name,
      })
      .from(decisionsTable)
      .leftJoin(policiesTable, eq(decisionsTable.policyId, policiesTable.id))
      .leftJoin(organizationsTable, eq(decisionsTable.organizationId, organizationsTable.id))
      .where(where)
      .orderBy(desc(decisionsTable.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(decisionsTable)
      .where(where),
  ]);

  res.json({
    decisions: rows,
    total: countResult[0]?.count ?? 0,
    page: pageNum,
    limit: pageSize,
  });
});

router.get("/decisions/:id", async (req, res): Promise<void> => {
  const params = GetDecisionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [row] = await db
    .select({
      id: decisionsTable.id,
      organizationId: decisionsTable.organizationId,
      policyId: decisionsTable.policyId,
      actor: decisionsTable.actor,
      action: decisionsTable.action,
      contextJson: decisionsTable.contextJson,
      outcome: decisionsTable.outcome,
      rulesAppliedJson: decisionsTable.rulesAppliedJson,
      explanation: decisionsTable.explanation,
      confidence: decisionsTable.confidence,
      scenario: decisionsTable.scenario,
      createdAt: decisionsTable.createdAt,
      policyName: policiesTable.name,
      organizationName: organizationsTable.name,
    })
    .from(decisionsTable)
    .leftJoin(policiesTable, eq(decisionsTable.policyId, policiesTable.id))
    .leftJoin(organizationsTable, eq(decisionsTable.organizationId, organizationsTable.id))
    .where(eq(decisionsTable.id, params.data.id));

  if (!row) { res.status(404).json({ error: "Decision not found" }); return; }
  res.json(row);
});

export default router;
