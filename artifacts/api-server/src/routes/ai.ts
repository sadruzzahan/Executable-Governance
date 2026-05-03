import { Router, type IRouter } from "express";
import { eq, and, ne } from "drizzle-orm";
import { db, rulesTable, policiesTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { AnalyzeRuleParams, AnalyzeRuleBody, SimulateRuleParams, SimulateRuleBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/rules/:id/analyze", async (req, res): Promise<void> => {
  const params = AnalyzeRuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = AnalyzeRuleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [rule] = await db
    .select({ id: rulesTable.id, name: rulesTable.name, policyId: rulesTable.policyId, outcome: rulesTable.outcome, structuredRepresentation: rulesTable.structuredRepresentation })
    .from(rulesTable)
    .where(eq(rulesTable.id, params.data.id));

  if (!rule) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }

  const siblings = await db
    .select({ id: rulesTable.id, name: rulesTable.name, naturalLanguageText: rulesTable.naturalLanguageText, outcome: rulesTable.outcome, status: rulesTable.status })
    .from(rulesTable)
    .where(and(eq(rulesTable.policyId, rule.policyId), ne(rulesTable.id, rule.id)));

  const siblingContext = siblings.length > 0
    ? `\n\nOther rules in the same policy:\n${siblings.map((s) => `- Rule #${s.id} "${s.name}" [${s.status}] [${s.outcome}]: ${s.naturalLanguageText}`).join("\n")}`
    : "\n\nNo other rules exist in this policy yet.";

  const systemPrompt = `You are a compliance analyst reviewing governance policy rules. Analyze the provided rule and return a structured JSON analysis.

Identify:
1. Ambiguities — open questions the rule leaves unresolved (e.g., undefined terms, missing thresholds, unclear scope)
2. Edge cases — specific scenarios the rule doesn't explicitly handle, with a suggested default behavior
3. Conflicts — logical contradictions or overlaps with other rules in the same policy that produce different outcomes for similar inputs

Respond with ONLY valid JSON matching this exact schema (no markdown, no preamble):
{
  "ambiguities": [
    { "id": "a1", "question": "What is the question?", "suggestedResolution": "Suggested fix", "field": "amount_threshold_or_null", "resolved": false }
  ],
  "edgeCases": [
    { "id": "e1", "scenario": "What happens when...", "suggestedBehavior": "Suggested default", "field": null, "resolved": false }
  ],
  "conflicts": [
    { "id": "c1", "conflictingRuleId": 5, "conflictingRuleName": "Rule name", "description": "Why they conflict", "severity": "high" }
  ]
}

Return 2-4 ambiguities, 2-4 edge cases, and only real conflicts (may be empty). Severity is one of: low, medium, high.`;

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

    let parsed: unknown;
    try {
      const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : fullResponse);
    } catch {
      parsed = { ambiguities: [], edgeCases: [], conflicts: [] };
    }

    res.write(`data: ${JSON.stringify({ type: "done", analysis: parsed })}\n\n`);
    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI analysis failed";
    res.write(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`);
    res.end();
  }
});

router.post("/rules/:id/simulate", async (req, res): Promise<void> => {
  const params = SimulateRuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = SimulateRuleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [rule] = await db
    .select({ id: rulesTable.id, name: rulesTable.name, naturalLanguageText: rulesTable.naturalLanguageText, outcome: rulesTable.outcome, structuredRepresentation: rulesTable.structuredRepresentation })
    .from(rulesTable)
    .leftJoin(policiesTable, eq(rulesTable.policyId, policiesTable.id))
    .where(eq(rulesTable.id, params.data.id));

  if (!rule) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }

  const systemPrompt = `You are a compliance policy decision engine. Given a governance rule and a hypothetical scenario, determine exactly how the rule would decide that scenario.

Rule:
Name: ${rule.name}
Text: ${rule.naturalLanguageText}
Default outcome: ${rule.outcome}
Structured conditions: ${JSON.stringify(rule.structuredRepresentation)}

Respond with ONLY valid JSON (no markdown, no preamble):
{
  "decision": "approved",
  "reasoning": "Plain-language explanation of why this decision was reached, referencing the specific rule conditions",
  "conditionsMet": ["Condition 1 that was satisfied", "Condition 2"],
  "conditionsNotMet": ["Condition that was not met, if any"]
}

decision must be one of: approved, denied, escalated, needs_review`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Scenario: ${body.data.scenario}` },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "";
    let parsed: unknown;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      parsed = {
        decision: "needs_review",
        reasoning: "Could not determine decision from scenario. Please clarify the scenario.",
        conditionsMet: [],
        conditionsNotMet: [],
      };
    }
    res.json(parsed);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI simulation failed";
    res.status(500).json({ error: msg });
  }
});

export default router;
