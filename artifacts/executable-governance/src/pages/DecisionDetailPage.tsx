import { useParams, Link } from "wouter";
import { useGetDecision } from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle, HelpCircle, FileText, User, Clock, Target } from "lucide-react";
import { cn } from "@/lib/utils";

type Outcome = "approved" | "denied" | "escalated" | "needs_review";

const OUTCOME_CONFIG: Record<Outcome, { label: string; icon: typeof CheckCircle; color: string; bg: string; border: string }> = {
  approved:     { label: "Approved",     icon: CheckCircle,    color: "text-green-500",  bg: "bg-green-500/10",  border: "border-green-500/30" },
  denied:       { label: "Denied",       icon: XCircle,        color: "text-red-500",    bg: "bg-red-500/10",    border: "border-red-500/30" },
  escalated:    { label: "Escalated",    icon: AlertTriangle,  color: "text-amber-500",  bg: "bg-amber-500/10",  border: "border-amber-500/30" },
  needs_review: { label: "Needs Review", icon: HelpCircle,     color: "text-slate-400",  bg: "bg-slate-400/10",  border: "border-slate-400/30" },
};

function formatDate(d: string | Date) {
  return new Date(d).toLocaleString(undefined, { dateStyle: "long", timeStyle: "medium" });
}

function ConditionRow({ cond }: { cond: Record<string, unknown> }) {
  const passed = Boolean(cond.passed);
  return (
    <div className={cn("flex items-center gap-3 px-3 py-2 rounded text-xs font-mono", passed ? "bg-green-500/10" : "bg-red-500/8")}>
      <span className={cn("shrink-0", passed ? "text-green-500" : "text-red-500")}>{passed ? "✓" : "✗"}</span>
      <span className="text-muted-foreground">{String(cond.field ?? "?")}</span>
      <span>{String(cond.operator ?? "")}</span>
      <span className="text-primary">{String(cond.ruleValue ?? "")}</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">context:</span>
      <span className={passed ? "text-foreground" : "text-red-400"}>
        {cond.contextValue !== undefined ? String(cond.contextValue) : "—"}
      </span>
    </div>
  );
}

interface AppliedRule {
  ruleId?: unknown;
  ruleName?: unknown;
  priority?: unknown;
  outcome?: unknown;
  matched?: unknown;
  matchScore?: unknown;
  conditions?: unknown[];
}

export function DecisionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const { data: decision, isLoading, error } = useGetDecision(id);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-8 text-sm text-muted-foreground">Loading decision…</div>
      </AppLayout>
    );
  }

  if (error || !decision) {
    return (
      <AppLayout>
        <div className="p-8">
          <p className="text-sm text-destructive">Decision not found.</p>
          <Link href="/decisions" className="text-xs text-primary hover:underline mt-2 inline-block">Back to audit log</Link>
        </div>
      </AppLayout>
    );
  }

  const outcomeKey = decision.outcome as Outcome;
  const outcomeConf = OUTCOME_CONFIG[outcomeKey] ?? OUTCOME_CONFIG.needs_review;
  const Icon = outcomeConf.icon;
  const rulesApplied: AppliedRule[] = Array.isArray(decision.rulesAppliedJson)
    ? (decision.rulesAppliedJson as AppliedRule[])
    : [];

  return (
    <AppLayout>
      <PageHeader
        title={`Decision #${decision.id}`}
        description={decision.scenario ?? `${decision.actor} · ${decision.action}`}
        actions={
          <Link href="/decisions">
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" /> Audit Log
            </button>
          </Link>
        }
      />
      <div className="p-8 space-y-6">
        {/* Outcome Banner */}
        <div className={cn("border rounded-lg p-6 flex items-start gap-5", outcomeConf.bg, outcomeConf.border)}>
          <Icon className={cn("w-9 h-9 shrink-0 mt-0.5", outcomeConf.color)} />
          <div className="flex-1 min-w-0">
            <div className={cn("text-2xl font-semibold", outcomeConf.color)} data-testid="decision-outcome">
              {outcomeConf.label}
            </div>
            <div className="mt-1 text-sm text-foreground/80">{decision.policyName ?? "Unknown policy"}</div>
            {decision.organizationName && (
              <div className="text-xs text-muted-foreground mt-0.5">{decision.organizationName}</div>
            )}
            <div className="mt-4 flex items-center gap-2">
              <div className="text-xs text-muted-foreground">Confidence</div>
              <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full", decision.confidence >= 80 ? "bg-green-500" : decision.confidence >= 50 ? "bg-amber-500" : "bg-slate-400")}
                  style={{ width: `${decision.confidence}%` }}
                />
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">{decision.confidence}%</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Metadata */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Request Details</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3 text-sm">
              <div className="flex items-start gap-2.5">
                <User className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground">Actor</div>
                  <div className="font-medium">{decision.actor}</div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Target className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground">Action</div>
                  <div className="font-mono">{decision.action}</div>
                </div>
              </div>
              {decision.policyId && (
                <div className="flex items-start gap-2.5">
                  <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">Policy</div>
                    <Link href={`/policies/${decision.policyId}`} className="text-primary hover:underline">
                      {decision.policyName}
                    </Link>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground">Recorded at</div>
                  <div className="tabular-nums">{formatDate(decision.createdAt)}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Context */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Query Context</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {Object.keys(decision.contextJson).length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No context fields provided.</p>
              ) : (
                <div className="space-y-1">
                  {Object.entries(decision.contextJson).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-muted-foreground w-32 truncate shrink-0">{k}</span>
                      <span className="text-primary">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Explanation */}
        {decision.explanation && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Explanation</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-foreground leading-relaxed" data-testid="decision-explanation">
                {decision.explanation}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Reasoning Chain */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              Reasoning Chain — {rulesApplied.length} rule{rulesApplied.length !== 1 ? "s" : ""} evaluated
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            {rulesApplied.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No rules were evaluated.</p>
            )}
            {rulesApplied.map((r, i) => {
              const matched = Boolean(r.matched);
              const conditions = Array.isArray(r.conditions) ? (r.conditions as Record<string, unknown>[]) : [];
              const score = typeof r.matchScore === "number" ? r.matchScore : 0;
              return (
                <div key={i} className={cn("border rounded-lg overflow-hidden", matched ? "border-primary/30" : "border-border/60")}>
                  <div className={cn("flex items-center gap-3 px-4 py-3", matched ? "bg-primary/5" : "bg-muted/30")}>
                    <span className="w-6 h-6 rounded text-[10px] font-mono flex items-center justify-center bg-muted text-muted-foreground shrink-0">
                      {String(r.priority ?? i + 1)}
                    </span>
                    <span className="font-medium text-sm flex-1">{String(r.ruleName ?? `Rule ${r.ruleId}`)}</span>
                    {matched && <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">matched</Badge>}
                    <span className={cn("text-[10px] uppercase tracking-wider font-mono",
                      r.outcome === "approved" ? "text-green-500"
                        : r.outcome === "denied" ? "text-red-500"
                        : r.outcome === "escalated" ? "text-amber-500"
                        : "text-muted-foreground"
                    )}>
                      {String(r.outcome ?? "")}
                    </span>
                    {!matched && (
                      <span className="text-[10px] tabular-nums text-muted-foreground">{Math.round(score * 100)}% match</span>
                    )}
                  </div>
                  {conditions.length > 0 && (
                    <div className="px-4 py-3 space-y-1.5 bg-background/50">
                      {conditions.map((c, ci) => <ConditionRow key={ci} cond={c} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
