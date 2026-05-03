import { useState, useRef } from "react";
import { useUpdateRule } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, ShieldAlert, AlertCircle, GitMerge, Pencil, X } from "lucide-react";

export interface AmbiguityItem {
  id: string;
  question: string;
  suggestedResolution: string;
  field: string | null;
  structuredUpdate: Record<string, unknown> | null;
  resolved: boolean;
}

export interface EdgeCaseItem {
  id: string;
  scenario: string;
  suggestedBehavior: string;
  field: string | null;
  structuredUpdate: Record<string, unknown> | null;
  resolved: boolean;
}

export interface ConflictItem {
  id: string;
  conflictingRuleId: number;
  conflictingRuleName: string;
  description: string;
  severity: "low" | "medium" | "high";
}

export interface RuleAnalysis {
  ambiguities: AmbiguityItem[];
  edgeCases: EdgeCaseItem[];
  conflicts: ConflictItem[];
}

interface Props {
  ruleId: number;
  naturalLanguageText: string;
  currentStructuredRepresentation: unknown;
  analysis: RuleAnalysis | null;
  onAnalysisComplete: (analysis: RuleAnalysis) => void;
  resolvedAmbiguities: AmbiguityItem[];
  resolvedEdgeCases: EdgeCaseItem[];
  onRefreshRule: () => void;
}

const SEVERITY_COLORS = {
  high: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
  low: "bg-sky-500/10 text-sky-600 dark:text-sky-300 border-sky-500/20",
};

function applyStructuredUpdate(
  current: unknown,
  item: AmbiguityItem | EdgeCaseItem,
  overrideText?: string
): { structuredUpdate: Record<string, unknown> | null } {
  if (overrideText && item.field) {
    const patch: Record<string, unknown> = { [item.field]: overrideText };
    return { structuredUpdate: patch };
  }
  return { structuredUpdate: item.structuredUpdate };
}

function ItemActions({
  item,
  type,
  onAccept,
  onOverride,
}: {
  item: AmbiguityItem | EdgeCaseItem;
  type: "ambiguity" | "edge";
  onAccept: () => void;
  onOverride: (overrideText: string) => void;
}) {
  const [showOverride, setShowOverride] = useState(false);
  const [overrideText, setOverrideText] = useState("");
  const prefix = type === "ambiguity" ? "ambiguity" : "edge";

  if (showOverride) {
    return (
      <div className="flex items-center gap-2 mt-1">
        <Input
          value={overrideText}
          onChange={(e) => setOverrideText(e.target.value)}
          placeholder="Enter your own resolution…"
          className="h-7 text-xs flex-1"
          data-testid={`override-input-${prefix}-${item.id}`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && overrideText.trim()) {
              onOverride(overrideText.trim());
              setShowOverride(false);
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={!overrideText.trim()}
          onClick={() => { onOverride(overrideText.trim()); setShowOverride(false); }}
          data-testid={`apply-override-${prefix}-${item.id}`}
        >
          Apply
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={() => setShowOverride(false)}
          aria-label="Cancel override"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={onAccept}
        data-testid={`accept-${prefix}-${item.id}`}
      >
        Accept suggestion
      </Button>
      {item.field && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => setShowOverride(true)}
          data-testid={`override-${prefix}-${item.id}`}
        >
          <Pencil className="w-3 h-3 mr-1" /> Override
        </Button>
      )}
    </div>
  );
}

export function RuleAnalysisPanel({
  ruleId,
  naturalLanguageText,
  currentStructuredRepresentation,
  analysis,
  onAnalysisComplete,
  resolvedAmbiguities,
  resolvedEdgeCases,
  onRefreshRule,
}: Props) {
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const update = useUpdateRule({ mutation: { onSuccess: onRefreshRule } });

  const isResolved = (type: "ambiguity" | "edge", id: string) => {
    if (type === "ambiguity") return resolvedAmbiguities.some((r) => r.id === id && r.resolved);
    return resolvedEdgeCases.some((r) => r.id === id && r.resolved);
  };

  const handleAnalyze = async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setStreaming(true);
    setStreamText("");
    setError(null);

    try {
      const resp = await fetch(`/api/rules/${ruleId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ naturalLanguageText }),
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) throw new Error(`Request failed: ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6)) as {
            type: "chunk" | "done" | "error";
            content?: string;
            analysis?: RuleAnalysis;
            error?: string;
          };
          if (payload.type === "chunk" && payload.content) {
            setStreamText((t) => t + payload.content);
          } else if (payload.type === "done" && payload.analysis) {
            const freshAnalysis = payload.analysis;
            onAnalysisComplete(freshAnalysis);
            setStreamText("");
            update.mutate({
              id: ruleId,
              data: {
                resolvedAmbiguities: freshAnalysis.ambiguities.map((a) => ({ ...a, resolved: false })) as unknown,
                resolvedEdgeCases: freshAnalysis.edgeCases.map((e) => ({ ...e, resolved: false })) as unknown,
              },
            });
          } else if (payload.type === "error") {
            setError(payload.error ?? "Analysis failed");
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setStreaming(false);
    }
  };

  const resolveAmbiguity = (item: AmbiguityItem, overrideText?: string) => {
    const { structuredUpdate } = applyStructuredUpdate(currentStructuredRepresentation, item, overrideText);
    const updatedList = resolvedAmbiguities.map((r) =>
      r.id === item.id ? { ...r, resolved: true, ...(overrideText ? { suggestedResolution: overrideText } : {}) } : r
    );
    const updates: Parameters<typeof update.mutate>[0]["data"] = {
      resolvedAmbiguities: updatedList as unknown,
    };
    if (structuredUpdate && Object.keys(structuredUpdate).length > 0) {
      const merged = { ...(currentStructuredRepresentation as Record<string, unknown> ?? {}), ...structuredUpdate };
      updates.structuredRepresentation = merged as unknown;
    }
    update.mutate({ id: ruleId, data: updates });
  };

  const resolveEdgeCase = (item: EdgeCaseItem, overrideText?: string) => {
    const { structuredUpdate } = applyStructuredUpdate(currentStructuredRepresentation, item, overrideText);
    const updatedList = resolvedEdgeCases.map((r) =>
      r.id === item.id ? { ...r, resolved: true, ...(overrideText ? { suggestedBehavior: overrideText } : {}) } : r
    );
    const updates: Parameters<typeof update.mutate>[0]["data"] = {
      resolvedEdgeCases: updatedList as unknown,
    };
    if (structuredUpdate && Object.keys(structuredUpdate).length > 0) {
      const merged = { ...(currentStructuredRepresentation as Record<string, unknown> ?? {}), ...structuredUpdate };
      updates.structuredRepresentation = merged as unknown;
    }
    update.mutate({ id: ruleId, data: updates });
  };

  const unresolvedAmbiguities = resolvedAmbiguities.filter((a) => !a.resolved);
  const unresolvedEdgeCases = resolvedEdgeCases.filter((e) => !e.resolved);
  const totalUnresolved = unresolvedAmbiguities.length + unresolvedEdgeCases.length;
  const hasAnalysis = analysis !== null || resolvedAmbiguities.length > 0 || resolvedEdgeCases.length > 0;

  const displayAmbiguities = analysis?.ambiguities ?? resolvedAmbiguities;
  const displayEdgeCases = analysis?.edgeCases ?? resolvedEdgeCases;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={handleAnalyze} disabled={streaming} data-testid="button-analyze-rule" className="gap-2">
          {streaming ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing…</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Analyze Rule</>
          )}
        </Button>
        {hasAnalysis && totalUnresolved === 0 && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> All items resolved — ready to publish
          </div>
        )}
        {hasAnalysis && totalUnresolved > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertCircle className="w-3.5 h-3.5" /> {totalUnresolved} unresolved — resolve before publishing
          </div>
        )}
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>
      )}

      {streaming && streamText && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <Loader2 className="w-3 h-3 animate-spin" /> Thinking…
          </div>
          <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-32 overflow-hidden">{streamText}</pre>
        </Card>
      )}

      {hasAnalysis && !streaming && (
        <div className="space-y-4">
          {displayAmbiguities.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-amber-500/5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-xs font-semibold uppercase tracking-wider">Ambiguities</span>
                <Badge variant="secondary" className="ml-auto text-xs">{displayAmbiguities.length}</Badge>
              </div>
              <ul className="divide-y divide-border">
                {displayAmbiguities.map((item) => {
                  const resolved = isResolved("ambiguity", item.id);
                  return (
                    <li key={item.id} className={`px-4 py-3 ${resolved ? "opacity-60" : ""}`} data-testid={`ambiguity-${item.id}`}>
                      <div className="text-sm text-foreground mb-1">{item.question}</div>
                      <div className="text-xs text-muted-foreground mb-2">
                        <span className="font-medium">Suggested:</span> {item.suggestedResolution}
                        {item.field && (
                          <span className="ml-2 font-mono text-[10px] bg-muted px-1 py-0.5 rounded">→ {item.field}</span>
                        )}
                      </div>
                      {resolved ? (
                        <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" /> Accepted
                          {item.field && <span className="text-muted-foreground ml-1">— applied to <code className="font-mono text-[10px]">{item.field}</code></span>}
                        </div>
                      ) : (
                        <ItemActions
                          item={item}
                          type="ambiguity"
                          onAccept={() => resolveAmbiguity(item)}
                          onOverride={(text) => resolveAmbiguity(item, text)}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {displayEdgeCases.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-sky-500/5">
                <ShieldAlert className="w-3.5 h-3.5 text-sky-600" />
                <span className="text-xs font-semibold uppercase tracking-wider">Edge Cases</span>
                <Badge variant="secondary" className="ml-auto text-xs">{displayEdgeCases.length}</Badge>
              </div>
              <ul className="divide-y divide-border">
                {displayEdgeCases.map((item) => {
                  const resolved = isResolved("edge", item.id);
                  return (
                    <li key={item.id} className={`px-4 py-3 ${resolved ? "opacity-60" : ""}`} data-testid={`edge-case-${item.id}`}>
                      <div className="text-sm text-foreground mb-1">{item.scenario}</div>
                      <div className="text-xs text-muted-foreground mb-2">
                        <span className="font-medium">Suggested default:</span> {item.suggestedBehavior}
                        {item.field && (
                          <span className="ml-2 font-mono text-[10px] bg-muted px-1 py-0.5 rounded">→ {item.field}</span>
                        )}
                      </div>
                      {resolved ? (
                        <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" /> Accepted
                          {item.field && <span className="text-muted-foreground ml-1">— applied to <code className="font-mono text-[10px]">{item.field}</code></span>}
                        </div>
                      ) : (
                        <ItemActions
                          item={item}
                          type="edge"
                          onAccept={() => resolveEdgeCase(item)}
                          onOverride={(text) => resolveEdgeCase(item, text)}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {(analysis?.conflicts ?? []).length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-red-500/5">
                <GitMerge className="w-3.5 h-3.5 text-red-600" />
                <span className="text-xs font-semibold uppercase tracking-wider">Conflicts</span>
                <Badge variant="destructive" className="ml-auto text-xs">{(analysis?.conflicts ?? []).length}</Badge>
              </div>
              <ul className="divide-y divide-border">
                {(analysis?.conflicts ?? []).map((item) => (
                  <li key={item.id} className="px-4 py-3" data-testid={`conflict-${item.id}`}>
                    <div className="flex items-start gap-2 mb-1">
                      <span className={`inline-block shrink-0 mt-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_COLORS[item.severity]}`}>
                        {item.severity.toUpperCase()}
                      </span>
                      <span className="text-sm text-foreground">{item.description}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Conflicts with:{" "}
                      <a href={`/rules/${item.conflictingRuleId}`} className="underline hover:text-foreground">
                        {item.conflictingRuleName}
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {displayAmbiguities.length === 0 && displayEdgeCases.length === 0 && (analysis?.conflicts ?? []).length === 0 && (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 py-2">
              <CheckCircle2 className="w-4 h-4" /> No issues found. This rule is clear and conflict-free.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
