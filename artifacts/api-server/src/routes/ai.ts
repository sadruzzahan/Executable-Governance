import { Router, type IRouter } from "express";
import { eq, and, ne } from "drizzle-orm";
import { db, rulesTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { AnalyzeRuleParams, AnalyzeRuleBody, SimulateRuleParams, SimulateRuleBody } from "@workspace/api-zod";

const router: IRouter = Router();

interface StructuredRep {
  kind?: string;
  field?: string;
  operator?: string;
  value?: number | string;
  currency?: string;
  scope?: string;
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
      return sibStr.field === ruleStr.field && s.outcome !== ruleOutcome;
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
          `Both rules evaluate the same field ("${ruleStr.field}") but produce different outcomes: ` +
          `this rule (${ownOp} ${ownVal} → ${ruleOutcome}) vs. "${s.name}" (${sibOp} ${sibVal} → ${s.outcome}). ` +
          `Ensure the condition ranges are mutually exclusive.`,
        severity: "high" as const,
      };
    });
}

router.post("/rules/:id/analyze", async (req, res): Promise<void> => {
  const params = AnalyzeRuleParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = AnalyzeRuleBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [rule] = await db
    .select({ id: rulesTable.id, name: rulesTable.name, policyId: rulesTable.policyId, outcome: rulesTable.outcome, structuredRepresentation: rulesTable.structuredRepresentation })
    .from(rulesTable)
    .where(eq(rulesTable.id, params.data.id));

  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }

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

    let aiAnalysis: { ambiguities: unknown[]; edgeCases: unknown[]; conflicts: unknown[] } = { ambiguities: [], edgeCases: [], conflicts: [] };
    try {
      const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
      aiAnalysis = JSON.parse(jsonMatch ? jsonMatch[0] : fullResponse) as typeof aiAnalysis;
    } catch { /* keep empty defaults */ }

    const mergedConflicts = [
      ...serverConflicts,
      ...(aiAnalysis.conflicts ?? []),
    ];

    const finalAnalysis = {
      ambiguities: aiAnalysis.ambiguities ?? [],
      edgeCases: aiAnalysis.edgeCases ?? [],
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

router.post("/rules/:id/simulate", async (req, res): Promise<void> => {
  const params = SimulateRuleParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = SimulateRuleBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [rule] = await db
    .select({ id: rulesTable.id, name: rulesTable.name, naturalLanguageText: rulesTable.naturalLanguageText, outcome: rulesTable.outcome, structuredRepresentation: rulesTable.structuredRepresentation })
    .from(rulesTable)
    .where(eq(rulesTable.id, params.data.id));

  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }

  const systemPrompt = `You are a compliance policy decision engine. Given a governance rule and a scenario, determine exactly how the rule would decide that scenario.

Rule name: ${rule.name}
Rule text: ${rule.naturalLanguageText}
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

    let parsed: unknown = {
      decision: "needs_review",
      reasoning: "Could not parse decision. Please clarify the scenario.",
      conditionsMet: [],
      conditionsNotMet: [],
    };
    try {
      const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : fullResponse);
    } catch { /* keep defaults */ }

    res.write(`data: ${JSON.stringify({ type: "done", result: parsed })}\n\n`);
    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI simulation failed";
    res.write(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`);
    res.end();
  }
});

export default router;
