import { send400 } from "../lib/validation";
import { Router, type IRouter } from "express";
import { eq, and, ne } from "drizzle-orm";
import { db, rulesTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { AnalyzeRuleParams, AnalyzeRuleBody, SimulateRuleParams, SimulateRuleBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/rbac";
import { loadOrgScopedRule } from "../lib/orgScope";
import { auditWrite } from "../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

interface StructuredRep {
  kind?: string;
  field?: string;
  operator?: string;
  value?: number | string;
  currency?: string;
  scope?: string;
}

function toNumericRange(op: string, val: number): [number, number] {
  const n = op.trim().toLowerCase().replace(/\s+/g, "");
  switch (n) {
    case "<":  case "lt":  return [-Infinity, val - Number.EPSILON];
    case "<=": case "lte": case "le": return [-Infinity, val];
    case ">":  case "gt":  return [val + Number.EPSILON, Infinity];
    case ">=": case "gte": case "ge": return [val, Infinity];
    case "=":  case "==":  case "eq": return [val, val];
    default: return [-Infinity, Infinity];
  }
}

function rangesOverlap([aLo, aHi]: [number, number], [bLo, bHi]: [number, number]): boolean {
  return aLo <= bHi && bLo <= aHi;
}

function conditionsOverlap(a: StructuredRep, b: StructuredRep): boolean {
  if (a.field !== b.field) return false;
  const aVal = typeof a.value === "number" ? a.value : parseFloat(String(a.value));
  const bVal = typeof b.value === "number" ? b.value : parseFloat(String(b.value));
  if (!isFinite(aVal) || !isFinite(bVal)) {
    return String(a.value) === String(b.value);
  }
  return rangesOverlap(toNumericRange(a.operator ?? "=", aVal), toNumericRange(b.operator ?? "=", bVal));
}

function detectServerConflicts(
  ruleId: number,
  ruleStr: StructuredRep | null,
  ruleOutcome: string,
  siblings: Array<{ id: number; name: string; outcome: string; status: string; structuredRepresentation: unknown }>
) {
  if (!ruleStr?.field) return [];
  return siblings
    .filter((s) => s.status === "published")
    .filter((s) => {
      const sibStr = s.structuredRepresentation as StructuredRep | null;
      if (!sibStr?.field) return false;
      return s.outcome !== ruleOutcome && conditionsOverlap(ruleStr, sibStr);
    })
    .map((s) => {
      const sibStr = s.structuredRepresentation as StructuredRep;
      const ownOp = ruleStr.operator ?? "—";
      const ownVal = ruleStr.value ?? "?";
      const sibOp = sibStr.operator ?? "—";
      const sibVal = sibStr.value ?? "?";
      return {
        id: `server-conflict-${ruleId}-${s.id}`,
        conflictingRuleId: s.id,
        conflictingRuleName: s.name,
        description:
          `Overlapping conditions on field "${ruleStr.field}": ` +
          `this rule (${ownOp} ${ownVal} → ${ruleOutcome}) and "${s.name}" (${sibOp} ${sibVal} → ${s.outcome}) ` +
          `can both match the same inputs with different outcomes. Ensure the condition ranges are mutually exclusive.`,
        severity: "high" as const,
      };
    });
}

// SSE streaming endpoint — response is text/event-stream with {type:"chunk"|"done"|"error"} events.
// Consume on the client via raw fetch + ReadableStream; the generated orval hook is not suitable for SSE.
router.post("/rules/:id/analyze", requirePermission("rule.analyze"), async (req, res): Promise<void> => {
  const params = AnalyzeRuleParams.safeParse(req.params);
  if (!params.success) { send400(res, req, params.error); return; }
  const body = AnalyzeRuleBody.safeParse(req.body);
  if (!body.success) { send400(res, req, body.error); return; }

  const scoped = await loadOrgScopedRule(params.data.id, req.user!.organizationId);
  if (!scoped) { res.status(404).json({ error: "Rule not found" }); return; }
  const [rule] = await db
    .select({ id: rulesTable.id, name: rulesTable.name, policyId: rulesTable.policyId, outcome: rulesTable.outcome, structuredRepresentation: rulesTable.structuredRepresentation })
    .from(rulesTable)
    .where(eq(rulesTable.id, params.data.id));

  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
  auditWrite({ req, action: "rule.analyze", resourceType: "rule", resourceId: rule.id, result: "success" });

  const siblings = await db
    .select({ id: rulesTable.id, name: rulesTable.name, naturalLanguageText: rulesTable.naturalLanguageText, outcome: rulesTable.outcome, status: rulesTable.status, structuredRepresentation: rulesTable.structuredRepresentation })
    .from(rulesTable)
    .where(and(eq(rulesTable.policyId, rule.policyId), ne(rulesTable.id, rule.id)));

  const serverConflicts = detectServerConflicts(
    rule.id,
    rule.structuredRepresentation as StructuredRep | null,
    rule.outcome,
    siblings
  );

  const siblingContext = siblings.length > 0
    ? `\n\nOther rules in the same policy:\n${siblings.map((s) => `- Rule #${s.id} "${s.name}" [${s.status}] [${s.outcome}]: ${s.naturalLanguageText}`).join("\n")}`
    : "\n\nNo other rules exist in this policy yet.";

  const structuredFields = `Structured representation field names available for patching: kind, field, operator, value, currency, scope.`;

  const systemPrompt = `You are a compliance analyst reviewing governance policy rules. Analyze the rule and respond ONLY with valid JSON (no markdown, no preamble).

Identify:
1. ambiguities — open questions (undefined terms, missing thresholds, unclear scope)
2. edgeCases — specific scenarios the rule doesn't explicitly handle
3. conflicts — logical contradictions or overlaps with sibling rules (may be empty if none)

${structuredFields}

Required JSON schema:
{
  "ambiguities": [
    {
      "id": "a1",
      "question": "What is the open question?",
      "suggestedResolution": "Concrete resolution text",
      "field": "currency",
      "structuredUpdate": { "currency": "USD" },
      "resolved": false
    }
  ],
  "edgeCases": [
    {
      "id": "e1",
      "scenario": "What happens when...?",
      "suggestedBehavior": "Suggested default behavior",
      "field": "scope",
      "structuredUpdate": { "scope": "domestic-only" },
      "resolved": false
    }
  ],
  "conflicts": []
}

Notes:
- "field" is one of: kind, field, operator, value, currency, scope — or null if the suggestion doesn't map to a structured field.
- "structuredUpdate" is a JSON patch object applying the suggested resolution to the structured representation, or null if not applicable.
- Return 2–4 ambiguities, 2–4 edge cases, and only real conflicts (may be empty []).
- Do NOT duplicate conflicts already detected by the server (supplied below).`;

  const userMessage = `Analyze this rule:
Name: ${rule.name}
Natural language text: ${body.data.naturalLanguageText}
Outcome: ${rule.outcome}
${siblingContext}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    let fullResponse = "";
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`);
      }
    }

    interface NormAmbiguity {
      id: string; question: string; suggestedResolution: string;
      field?: string | null; structuredUpdate?: unknown; resolved: boolean;
    }
    interface NormEdgeCase {
      id: string; scenario: string; suggestedBehavior: string;
      field?: string | null; structuredUpdate?: unknown; resolved: boolean;
    }

    const normalizeAmbiguity = (raw: unknown, idx: number): NormAmbiguity => {
      const a = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      return {
        id: typeof a.id === "string" ? a.id : `ambiguity-${idx}`,
        question: typeof a.question === "string" ? a.question : "Unspecified ambiguity",
        suggestedResolution: typeof a.suggestedResolution === "string" ? a.suggestedResolution : "",
        field: typeof a.field === "string" ? a.field : null,
        structuredUpdate: a.structuredUpdate ?? null,
        resolved: false,
      };
    };

    const normalizeEdgeCase = (raw: unknown, idx: number): NormEdgeCase => {
      const e = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      return {
        id: typeof e.id === "string" ? e.id : `edge-${idx}`,
        scenario: typeof e.scenario === "string" ? e.scenario : "Unspecified edge case",
        suggestedBehavior: typeof e.suggestedBehavior === "string" ? e.suggestedBehavior : "",
        field: typeof e.field === "string" ? e.field : null,
        structuredUpdate: e.structuredUpdate ?? null,
        resolved: false,
      };
    };

    let aiAnalysis: { ambiguities: NormAmbiguity[]; edgeCases: NormEdgeCase[]; conflicts: unknown[] } = { ambiguities: [], edgeCases: [], conflicts: [] };
    try {
      const parsed = JSON.parse(fullResponse) as Record<string, unknown>;
      if (Array.isArray(parsed.ambiguities)) aiAnalysis.ambiguities = parsed.ambiguities.map(normalizeAmbiguity);
      if (Array.isArray(parsed.edgeCases)) aiAnalysis.edgeCases = parsed.edgeCases.map(normalizeEdgeCase);
      if (Array.isArray(parsed.conflicts)) aiAnalysis.conflicts = parsed.conflicts;
    } catch {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Model returned malformed JSON" })}\n\n`);
      res.end();
      return;
    }

    // Validate/normalise AI-returned conflict objects so the UI can safely call `.severity.toUpperCase()` etc.
    const VALID_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
    interface ConflictItem {
      id: string;
      severity: "low" | "medium" | "high" | "critical";
      description: string;
      conflictingRuleId?: number;
      conflictingRuleName?: string;
    }
    const normalizeConflict = (raw: unknown, idx: number): ConflictItem => {
      const c = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      return {
        id: typeof c.id === "string" ? c.id : `ai-conflict-${idx}`,
        severity: typeof c.severity === "string" && VALID_SEVERITIES.has(c.severity)
          ? (c.severity as ConflictItem["severity"])
          : "medium",
        description: typeof c.description === "string" ? c.description : "Conflict detected by AI",
        conflictingRuleId: typeof c.conflictingRuleId === "number" ? c.conflictingRuleId : undefined,
        conflictingRuleName: typeof c.conflictingRuleName === "string" ? c.conflictingRuleName : undefined,
      };
    };

    // Only include AI conflicts that have valid rule references (to avoid broken /rules/undefined links).
    // Deterministic server conflicts always carry full rule metadata, so they are always kept.
    const validAiConflicts = aiAnalysis.conflicts
      .map(normalizeConflict)
      .filter((c) => c.conflictingRuleId !== undefined && c.conflictingRuleName !== undefined);

    const mergedConflicts = [
      ...serverConflicts,
      ...validAiConflicts,
    ];

    const finalAnalysis = {
      ambiguities: aiAnalysis.ambiguities,
      edgeCases: aiAnalysis.edgeCases,
      conflicts: mergedConflicts,
    };

    res.write(`data: ${JSON.stringify({ type: "done", analysis: finalAnalysis })}\n\n`);
    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI analysis failed";
    res.write(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`);
    res.end();
  }
});

// SSE streaming endpoint — response is text/event-stream with {type:"chunk"|"done"|"error"} events.
// Consume on the client via raw fetch + ReadableStream; the generated orval hook is not suitable for SSE.
router.post("/rules/:id/simulate", requirePermission("rule.simulate"), async (req, res): Promise<void> => {
  const params = SimulateRuleParams.safeParse(req.params);
  if (!params.success) { send400(res, req, params.error); return; }
  const body = SimulateRuleBody.safeParse(req.body);
  if (!body.success) { send400(res, req, body.error); return; }

  const scoped = await loadOrgScopedRule(params.data.id, req.user!.organizationId);
  if (!scoped) { res.status(404).json({ error: "Rule not found" }); return; }
  const [rule] = await db
    .select({ id: rulesTable.id, name: rulesTable.name, naturalLanguageText: rulesTable.naturalLanguageText, outcome: rulesTable.outcome, structuredRepresentation: rulesTable.structuredRepresentation })
    .from(rulesTable)
    .where(eq(rulesTable.id, params.data.id));

  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
  auditWrite({ req, action: "rule.simulate", resourceType: "rule", resourceId: rule.id, result: "success" });

  // Use caller-supplied ruleText (e.g. unsaved draft) when provided, else fall back to DB value
  const effectiveRuleText = body.data.ruleText ?? rule.naturalLanguageText;

  const systemPrompt = `You are a compliance policy decision engine. Given a governance rule and a scenario, determine exactly how the rule would decide that scenario.

Rule name: ${rule.name}
Rule text: ${effectiveRuleText}
Default outcome: ${rule.outcome}
Structured conditions: ${JSON.stringify(rule.structuredRepresentation)}

Respond ONLY with valid JSON (no markdown, no preamble):
{
  "decision": "approved",
  "reasoning": "Plain-language explanation referencing the specific rule conditions",
  "conditionsMet": ["condition 1 that was satisfied"],
  "conditionsNotMet": ["condition that was not met, if any"]
}

decision must be one of: approved, denied, escalated, needs_review`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    let fullResponse = "";
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Scenario: ${body.data.scenario}` },
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`);
      }
    }

    const VALID_DECISIONS = new Set(["approved", "denied", "escalated", "needs_review"]);
    interface SimResult {
      decision: "approved" | "denied" | "escalated" | "needs_review";
      reasoning: string;
      conditionsMet: string[];
      conditionsNotMet: string[];
    }
    let result: SimResult = {
      decision: "needs_review",
      reasoning: "Could not parse decision. Please clarify the scenario.",
      conditionsMet: [],
      conditionsNotMet: [],
    };
    try {
      const raw = JSON.parse(fullResponse) as Record<string, unknown>;
      const decision = typeof raw.decision === "string" && VALID_DECISIONS.has(raw.decision)
        ? (raw.decision as SimResult["decision"])
        : "needs_review";
      result = {
        decision,
        reasoning: typeof raw.reasoning === "string" ? raw.reasoning : result.reasoning,
        conditionsMet: Array.isArray(raw.conditionsMet) ? (raw.conditionsMet as string[]).filter((s) => typeof s === "string") : [],
        conditionsNotMet: Array.isArray(raw.conditionsNotMet) ? (raw.conditionsNotMet as string[]).filter((s) => typeof s === "string") : [],
      };
    } catch { /* keep defaults */ }

    res.write(`data: ${JSON.stringify({ type: "done", result })}\n\n`);
    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI simulation failed";
    res.write(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`);
    res.end();
  }
});

export default router;
