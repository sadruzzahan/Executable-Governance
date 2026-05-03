import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, PlayCircle, CheckCircle2, XCircle, AlertTriangle, HelpCircle } from "lucide-react";

interface SimulationResult {
  decision: "approved" | "denied" | "escalated" | "needs_review";
  reasoning: string;
  conditionsMet: string[];
  conditionsNotMet: string[];
}

interface Props {
  ruleId: number;
}

const DECISION_CONFIG = {
  approved: {
    label: "APPROVED",
    icon: CheckCircle2,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    iconClass: "text-emerald-600",
  },
  denied: {
    label: "DENIED",
    icon: XCircle,
    className: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
    iconClass: "text-red-600",
  },
  escalated: {
    label: "ESCALATED",
    icon: AlertTriangle,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    iconClass: "text-amber-600",
  },
  needs_review: {
    label: "NEEDS REVIEW",
    icon: HelpCircle,
    className: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
    iconClass: "text-sky-600",
  },
} as const;

export function SimulationPanel({ ruleId }: Props) {
  const [scenario, setScenario] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSimulate = async () => {
    if (!scenario.trim()) return;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setStreaming(true);
    setStreamText("");
    setResult(null);
    setError(null);

    try {
      const resp = await fetch(`/api/rules/${ruleId}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: scenario.trim() }),
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
            result?: SimulationResult;
            error?: string;
          };
          if (payload.type === "chunk" && payload.content) {
            setStreamText((t) => t + payload.content);
          } else if (payload.type === "done" && payload.result) {
            // Defensively normalise fields that AI might omit
            const r = payload.result;
            setResult({
              decision: r.decision ?? "needs_review",
              reasoning: r.reasoning ?? "",
              conditionsMet: Array.isArray(r.conditionsMet) ? r.conditionsMet : [],
              conditionsNotMet: Array.isArray(r.conditionsNotMet) ? r.conditionsNotMet : [],
            });
            setStreamText("");
          } else if (payload.type === "error") {
            setError(payload.error ?? "Simulation failed");
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setStreaming(false);
    }
  };

  const config = result ? DECISION_CONFIG[result.decision] : null;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="scenario-input">Describe a hypothetical scenario</Label>
        <Textarea
          id="scenario-input"
          rows={3}
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
          placeholder="e.g. $180 dinner with 3 attendees, receipt attached, submitted day after travel"
          data-testid="textarea-scenario"
        />
      </div>
      <Button
        onClick={handleSimulate}
        disabled={streaming || !scenario.trim()}
        data-testid="button-simulate"
        className="gap-2"
      >
        {streaming ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Simulating…</>
        ) : (
          <><PlayCircle className="w-4 h-4" /> Simulate</>
        )}
      </Button>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>
      )}

      {streaming && streamText && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <Loader2 className="w-3 h-3 animate-spin" /> Reasoning…
          </div>
          <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-28 overflow-hidden">{streamText}</pre>
        </Card>
      )}

      {result && config && (
        <Card className="overflow-hidden" data-testid="simulation-result">
          <div className={`px-4 py-3 border-b border-border flex items-center gap-2.5 ${config.className} border`}>
            <config.icon className={`w-5 h-5 ${config.iconClass}`} />
            <span className="text-base font-bold tracking-wide">{config.label}</span>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Reasoning</div>
              <p className="text-sm leading-relaxed text-foreground" data-testid="simulation-reasoning">{result.reasoning}</p>
            </div>
            {result.conditionsMet.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Conditions Met</div>
                <ul className="space-y-1">
                  {result.conditionsMet.map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-foreground">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.conditionsNotMet.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Conditions Not Met</div>
                <ul className="space-y-1">
                  {result.conditionsNotMet.map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-foreground">
                      <XCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
