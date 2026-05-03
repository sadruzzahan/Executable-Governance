import { useState, useRef } from "react";
import { useUpdateRule } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, ShieldAlert, AlertCircle, GitMerge } from "lucide-react";

export interface AmbiguityItem {
  id: string;
  question: string;
  suggestedResolution: string;
  field: string | null;
  resolved: boolean;
}

export interface EdgeCaseItem {
  id: string;
  scenario: string;
  suggestedBehavior: string;
  field: string | null;
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

export function RuleAnalysisPanel({
  ruleId,
  naturalLanguageText,
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
    if (type === "ambiguity") return resolvedAmbiguities.some((r) => r.id === id);
    return resolvedEdgeCases.some((r) => r.id === id);
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

      if (!resp.ok || !resp.body) {
        throw new Error(`Request failed: ${resp.status}`);
      }

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
            onAnalysisComplete(payload.analysis);
            setStreamText("");
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

  const handleAcceptAmbiguity = (item: AmbiguityItem) => {
    const current = resolvedAmbiguities.filter((r) => r.id !== item.id);
    update.mutate({
      id: ruleId,
      data: { resolvedAmbiguities: [...current, { ...item, resolved: true }] as unknown as undefined },
    });
  };

  const handleAcceptEdgeCase = (item: EdgeCaseItem) => {
    const current = resolvedEdgeCases.filter((r) => r.id !== item.id);
    update.mutate({
      id: ruleId,
      data: { resolvedEdgeCases: [...current, { ...item, resolved: true }] as unknown as undefined },
    });
  };

  const unresolvedAmbiguities = analysis?.ambiguities.filter((a) => !isResolved("ambiguity", a.id)) ?? [];
  const unresolvedEdgeCases = analysis?.edgeCases.filter((e) => !isResolved("edge", e.id)) ?? [];
  const totalUnresolved = unresolvedAmbiguities.length + unresolvedEdgeCases.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          onClick={handleAnalyze}
          disabled={streaming}
          data-testid="button-analyze-rule"
          className="gap-2"
        >
          {streaming ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing…</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Analyze Rule</>
          )}
        </Button>
        {analysis && totalUnresolved === 0 && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> All items resolved
          </div>
        )}
        {analysis && totalUnresolved > 0 && (
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

      {analysis && !streaming && (
        <div className="space-y-4">
          {analysis.ambiguities.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-amber-500/5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-xs font-semibold uppercase tracking-wider">Ambiguities</span>
                <Badge variant="secondary" className="ml-auto text-xs">{analysis.ambiguities.length}</Badge>
              </div>
              <ul className="divide-y divide-border">
                {analysis.ambiguities.map((item) => {
                  const resolved = isResolved("ambiguity", item.id);
                  return (
                    <li key={item.id} className={`px-4 py-3 ${resolved ? "opacity-60" : ""}`} data-testid={`ambiguity-${item.id}`}>
                      <div className="text-sm text-foreground mb-1">{item.question}</div>
                      <div className="text-xs text-muted-foreground mb-2">
                        <span className="font-medium">Suggested:</span> {item.suggestedResolution}
                      </div>
                      {resolved ? (
                        <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" /> Accepted
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleAcceptAmbiguity(item)} data-testid={`accept-ambiguity-${item.id}`}>
                          Accept suggestion
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {analysis.edgeCases.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-sky-500/5">
                <ShieldAlert className="w-3.5 h-3.5 text-sky-600" />
                <span className="text-xs font-semibold uppercase tracking-wider">Edge Cases</span>
                <Badge variant="secondary" className="ml-auto text-xs">{analysis.edgeCases.length}</Badge>
              </div>
              <ul className="divide-y divide-border">
                {analysis.edgeCases.map((item) => {
                  const resolved = isResolved("edge", item.id);
                  return (
                    <li key={item.id} className={`px-4 py-3 ${resolved ? "opacity-60" : ""}`} data-testid={`edge-case-${item.id}`}>
                      <div className="text-sm text-foreground mb-1">{item.scenario}</div>
                      <div className="text-xs text-muted-foreground mb-2">
                        <span className="font-medium">Suggested default:</span> {item.suggestedBehavior}
                      </div>
                      {resolved ? (
                        <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" /> Accepted
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleAcceptEdgeCase(item)} data-testid={`accept-edge-${item.id}`}>
                          Accept suggestion
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {analysis.conflicts.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-red-500/5">
                <GitMerge className="w-3.5 h-3.5 text-red-600" />
                <span className="text-xs font-semibold uppercase tracking-wider">Conflicts</span>
                <Badge variant="destructive" className="ml-auto text-xs">{analysis.conflicts.length}</Badge>
              </div>
              <ul className="divide-y divide-border">
                {analysis.conflicts.map((item) => (
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

          {analysis.ambiguities.length === 0 && analysis.edgeCases.length === 0 && analysis.conflicts.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 py-2">
              <CheckCircle2 className="w-4 h-4" /> No issues found. This rule is clear and conflict-free.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
