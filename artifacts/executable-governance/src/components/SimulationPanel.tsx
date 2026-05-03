import { useState } from "react";
import { useSimulateRule } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, PlayCircle, CheckCircle2, XCircle, AlertTriangle, HelpCircle } from "lucide-react";

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

type DecisionKey = keyof typeof DECISION_CONFIG;

export function SimulationPanel({ ruleId }: Props) {
  const [scenario, setScenario] = useState("");
  const simulate = useSimulateRule();

  const handleSimulate = () => {
    if (!scenario.trim()) return;
    simulate.mutate({ id: ruleId, data: { scenario: scenario.trim() } });
  };

  const result = simulate.data;
  const decisionKey = result?.decision as DecisionKey | undefined;
  const config = decisionKey ? DECISION_CONFIG[decisionKey] : null;

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
        disabled={simulate.isPending || !scenario.trim()}
        data-testid="button-simulate"
        className="gap-2"
      >
        {simulate.isPending ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Simulating…</>
        ) : (
          <><PlayCircle className="w-4 h-4" /> Simulate</>
        )}
      </Button>

      {simulate.isError && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {simulate.error instanceof Error ? simulate.error.message : "Simulation failed"}
        </div>
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
