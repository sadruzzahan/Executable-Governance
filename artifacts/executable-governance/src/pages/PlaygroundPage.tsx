import { useState } from "react";
import { Link } from "wouter";
import { useListPolicies, useEvaluateDecision } from "@workspace/api-client-react";
import type { DecisionResult } from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, AlertTriangle, HelpCircle, ChevronRight, Plus, Trash2, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type ContextEntry = { key: string; value: string };

const OUTCOME_CONFIG = {
  approved: { label: "Approved", icon: CheckCircle, color: "text-green-500", bg: "bg-green-500/10 border-green-500/30" },
  denied: { label: "Denied", icon: XCircle, color: "text-red-500", bg: "bg-red-500/10 border-red-500/30" },
  escalated: { label: "Escalated", icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/30" },
  needs_review: { label: "Needs Review", icon: HelpCircle, color: "text-slate-400", bg: "bg-slate-400/10 border-slate-400/30" },
} as const;

const EXAMPLE_SCENARIOS = [
  { label: "High-value meal ($350)", actor: "alice@corp.com", action: "submit_expense", context: [{ key: "amount", value: "350" }, { key: "category", value: "meals" }, { key: "attendees", value: "2" }] },
  { label: "Software subscription ($89)", actor: "bob@corp.com", action: "submit_expense", context: [{ key: "amount", value: "89" }, { key: "category", value: "software" }, { key: "receipt_attached", value: "true" }] },
  { label: "International travel ($4200)", actor: "carol@corp.com", action: "submit_expense", context: [{ key: "amount", value: "4200" }, { key: "category", value: "travel" }, { key: "international", value: "true" }] },
];

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", value >= 80 ? "bg-green-500" : value >= 50 ? "bg-amber-500" : "bg-slate-400")}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{value}%</span>
    </div>
  );
}

export function PlaygroundPage() {
  const { toast } = useToast();
  const { data: policiesData } = useListPolicies({ status: "published" });
  const policies = policiesData ?? [];

  const [policyId, setPolicyId] = useState<string>("");
  const [actor, setActor] = useState("user@example.com");
  const [action, setAction] = useState("submit_expense");
  const [scenario, setScenario] = useState("");
  const [context, setContext] = useState<ContextEntry[]>([{ key: "", value: "" }]);
  const [result, setResult] = useState<DecisionResult | null>(null);

  const { mutate: evaluate, isPending } = useEvaluateDecision({
    mutation: {
      onSuccess: (data) => setResult(data),
      onError: (err) => {
        const msg = (err as { message?: string })?.message ?? "Evaluation failed";
        toast({ title: "Evaluation failed", description: msg, variant: "destructive" });
      },
    },
  });

  const addContextRow = () => setContext((prev) => [...prev, { key: "", value: "" }]);
  const removeContextRow = (i: number) => setContext((prev) => prev.filter((_, idx) => idx !== i));
  const updateContextRow = (i: number, field: "key" | "value", val: string) =>
    setContext((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));

  const loadExample = (ex: (typeof EXAMPLE_SCENARIOS)[number]) => {
    if (policies.length > 0 && !policyId) {
      setPolicyId(String(policies[0].id));
    }
    setActor(ex.actor);
    setAction(ex.action);
    setContext(ex.context);
    setScenario(ex.label);
  };

  const handleSubmit = () => {
    if (!policyId) {
      toast({ title: "Select a policy", description: "Choose a published policy to evaluate against.", variant: "destructive" });
      return;
    }
    const ctx: Record<string, unknown> = {};
    for (const { key, value } of context) {
      if (!key.trim()) continue;
      const num = Number(value);
      ctx[key.trim()] = !isNaN(num) && value.trim() !== "" ? num : value.trim() === "true" ? true : value.trim() === "false" ? false : value;
    }
    evaluate({ data: { policyId: Number(policyId), actor, action, context: ctx, scenario: scenario || undefined } });
  };

  const outcomeKey = result?.decision as keyof typeof OUTCOME_CONFIG | undefined;
  const outcomeConf = outcomeKey ? OUTCOME_CONFIG[outcomeKey] : null;

  return (
    <AppLayout>
      <PageHeader
        title="Decision Playground"
        description="Try the governance engine against any published policy. Submit a query and see the full reasoning chain in real time."
      />
      <div className="p-8 grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="space-y-5">
          {/* Quick Examples */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Quick Examples</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex flex-wrap gap-2">
              {EXAMPLE_SCENARIOS.map((ex) => (
                <button
                  key={ex.label}
                  onClick={() => loadExample(ex)}
                  className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent/40 transition-colors text-muted-foreground hover:text-foreground"
                >
                  {ex.label}
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Policy + Actor */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Policy</Label>
                <Select value={policyId} onValueChange={setPolicyId}>
                  <SelectTrigger data-testid="select-policy">
                    <SelectValue placeholder="Select a published policy…" />
                  </SelectTrigger>
                  <SelectContent>
                    {policies.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No published policies</div>
                    )}
                    {policies.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Actor</Label>
                  <Input
                    value={actor}
                    onChange={(e) => setActor(e.target.value)}
                    placeholder="user@example.com"
                    data-testid="input-actor"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Action</Label>
                  <Input
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                    placeholder="submit_expense"
                    data-testid="input-action"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Scenario (optional)</Label>
                <Textarea
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  placeholder="Describe the scenario in plain English…"
                  className="resize-none h-16"
                  data-testid="input-scenario"
                />
              </div>
            </CardContent>
          </Card>

          {/* Context Fields */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Context Fields</CardTitle>
              <button
                onClick={addContextRow}
                className="text-xs flex items-center gap-1 text-primary hover:text-primary/80 transition-colors"
              >
                <Plus className="w-3 h-3" /> Add field
              </button>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {context.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={row.key}
                    onChange={(e) => updateContextRow(i, "key", e.target.value)}
                    placeholder="field name"
                    className="flex-1 font-mono text-xs"
                  />
                  <Input
                    value={row.value}
                    onChange={(e) => updateContextRow(i, "value", e.target.value)}
                    placeholder="value"
                    className="flex-1 font-mono text-xs"
                  />
                  <button
                    onClick={() => removeContextRow(i)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {context.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No context fields — add key/value pairs above.</p>
              )}
            </CardContent>
          </Card>

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={isPending || !policyId}
            data-testid="button-evaluate"
          >
            {isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Evaluating…</>
            ) : (
              <><ChevronRight className="w-4 h-4 mr-1" /> Evaluate</>
            )}
          </Button>
        </div>

        {/* Result Panel */}
        <div>
          {!result && !isPending && (
            <Card className="h-full flex items-center justify-center min-h-[320px]">
              <div className="text-center text-muted-foreground px-6">
                <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                  <ChevronRight className="w-5 h-5" />
                </div>
                <p className="text-sm font-medium">No result yet</p>
                <p className="text-xs mt-1">Configure a query on the left and click Evaluate to see the decision.</p>
              </div>
            </Card>
          )}

          {isPending && (
            <Card className="h-full flex items-center justify-center min-h-[320px]">
              <div className="text-center text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
                <p className="text-sm">Running engine…</p>
              </div>
            </Card>
          )}

          {result && outcomeConf && (
            <div className="space-y-4">
              {/* Outcome banner */}
              <div className={cn("border rounded-lg p-5 flex items-start gap-4", outcomeConf.bg)}>
                <outcomeConf.icon className={cn("w-7 h-7 shrink-0 mt-0.5", outcomeConf.color)} />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-xl font-semibold", outcomeConf.color)} data-testid="decision-outcome">
                    {outcomeConf.label}
                  </div>
                  <div className="mt-1 text-sm text-foreground/80">{result.policyName}</div>
                  <div className="mt-3">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Confidence</div>
                    <ConfidenceBar value={result.confidence} />
                  </div>
                </div>
                <Link href={`/decisions/${result.id}`}>
                  <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" /> View audit record
                  </button>
                </Link>
              </div>

              {/* Explanation */}
              {result.explanation && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Explanation</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-sm text-foreground leading-relaxed" data-testid="decision-explanation">{result.explanation}</p>
                  </CardContent>
                </Card>
              )}

              {/* Rules evaluated */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Rules Evaluated</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-1">
                  {result.rulesApplied.map((r, i) => (
                    <div
                      key={r.ruleId}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md text-sm",
                        r.matched ? "bg-primary/10" : "opacity-60"
                      )}
                      data-testid={`rule-ref-${i}`}
                    >
                      <span className="w-6 h-6 rounded text-[10px] font-mono flex items-center justify-center bg-muted text-muted-foreground shrink-0">
                        {r.priority}
                      </span>
                      <span className="flex-1 truncate font-medium">{r.name}</span>
                      {r.matched && (
                        <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">matched</Badge>
                      )}
                      <span className={cn("text-[10px] uppercase tracking-wider font-mono",
                        r.outcome === "approved" ? "text-green-500"
                          : r.outcome === "denied" ? "text-red-500"
                          : r.outcome === "escalated" ? "text-amber-500"
                          : "text-muted-foreground"
                      )}>
                        {r.outcome}
                      </span>
                    </div>
                  ))}
                  {result.rulesApplied.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No rules evaluated.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
