import { useEffect, useRef, useState } from "react";
import {
  useGetAnalyticsSummary,
  getGetAnalyticsSummaryQueryKey,
  useGetDecisionVolume,
  getGetDecisionVolumeQueryKey,
  useGetTopRules,
  getGetTopRulesQueryKey,
  useGetCoverageGaps,
  getGetCoverageGapsQueryKey,
  useGetRuleHealth,
  getGetRuleHealthQueryKey,
  useListDecisions,
  getListDecisionsQueryKey,
} from "@workspace/api-client-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import {
  Activity, CheckCircle2, AlertTriangle, Scale, FileText,
  TrendingUp, ShieldAlert, Zap, ArrowRight,
} from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import type { DecisionList, DecisionSummary, DecisionVolumeDay, TopRuleItem, CoverageGapItem, RuleHealthItem } from "@workspace/api-client-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REFETCH_MS = 60_000;

function timeAgo(d: string | Date) {
  const sec = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function fmtDate(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}

const OUTCOME_COLORS: Record<string, string> = {
  approved:    "#22c55e",
  denied:      "#ef4444",
  escalated:   "#f59e0b",
  needs_review:"#94a3b8",
};

const OUTCOME_LABELS: Record<string, string> = {
  approved: "Approved",
  denied: "Denied",
  escalated: "Escalated",
  needs_review: "Needs Review",
};

function OutcomeBadge({ outcome }: { outcome: string }) {
  const colors: Record<string, string> = {
    approved: "bg-green-900/40 text-green-300 border-green-700/50",
    denied: "bg-red-900/40 text-red-300 border-red-700/50",
    escalated: "bg-amber-900/40 text-amber-300 border-amber-700/50",
    needs_review: "bg-slate-700/60 text-slate-300 border-slate-600/50",
  };
  return (
    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border", colors[outcome] ?? "bg-muted text-muted-foreground border-border")}>
      {OUTCOME_LABELS[outcome] ?? outcome}
    </span>
  );
}

// ─── Count-up animation ───────────────────────────────────────────────────────

function useCountUp(target: number, duration = 700) {
  const [value, setValue] = useState(0);
  const ref = useRef(false);
  useEffect(() => {
    if (target === 0 || ref.current) { setValue(target); return; }
    ref.current = true;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(eased * target));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return value;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, testId, accent,
}: {
  icon: typeof Activity;
  label: string;
  value: number | string;
  sub?: string;
  testId: string;
  accent?: "green" | "red" | "amber" | "blue";
}) {
  const animated = useCountUp(typeof value === "number" ? value : 0);
  const display = typeof value === "number" ? animated : value;

  const accentClasses: Record<string, string> = {
    green: "bg-green-500/10 text-green-400",
    red:   "bg-red-500/10 text-red-400",
    amber: "bg-amber-500/10 text-amber-400",
    blue:  "bg-blue-500/10 text-blue-400",
  };

  return (
    <Card data-testid={testId}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
            <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{display}</div>
            {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
          </div>
          <div className={cn("w-8 h-8 rounded flex items-center justify-center shrink-0", accentClasses[accent ?? "blue"] ?? accentClasses.blue)}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Decision Volume Chart ────────────────────────────────────────────────────

function DecisionVolumeChart({ days, total }: { days?: DecisionVolumeDay[]; total?: number }) {
  const data = days ?? [];
  const isEmpty = data.length === 0;

  return (
    <Card className="lg:col-span-2" data-testid="card-decision-volume">
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="text-sm font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            Decision Volume — Last 30 Days
          </span>
          {total != null && (
            <span className="text-xs font-normal text-muted-foreground tabular-nums">{total} total</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 px-2 pb-2">
        {isEmpty ? (
          <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">
            No decision data in the last 30 days
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={176}>
            <BarChart data={data} margin={{ top: 4, right: 12, left: -20, bottom: 0 }} barSize={8}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                labelFormatter={fmtDate}
                cursor={{ fill: "hsl(var(--accent)/0.3)" }}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={(v) => OUTCOME_LABELS[v] ?? v} />
              <Bar dataKey="approved"    stackId="a" fill={OUTCOME_COLORS.approved}    radius={[0,0,0,0]} />
              <Bar dataKey="needs_review" stackId="a" fill={OUTCOME_COLORS.needs_review} radius={[0,0,0,0]} />
              <Bar dataKey="escalated"   stackId="a" fill={OUTCOME_COLORS.escalated}   radius={[0,0,0,0]} />
              <Bar dataKey="denied"      stackId="a" fill={OUTCOME_COLORS.denied}      radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Top Rules Panel ──────────────────────────────────────────────────────────

function TopRulesPanel({ rules }: { rules?: TopRuleItem[] }) {
  const items = rules ?? [];
  const maxTrigger = Math.max(...items.map((r) => r.triggerCount), 1);

  return (
    <Card data-testid="card-top-rules">
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4 text-muted-foreground" />
          Top Triggered Rules
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">No rule triggers yet</div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((rule, idx) => {
              const pct = Math.round((rule.triggerCount / maxTrigger) * 100);
              return (
                <li key={rule.ruleId} className="px-4 py-3" data-testid={`top-rule-${idx}`}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <Link href={`/rules/${rule.ruleId}?tab=analysis`} className="text-sm font-medium hover:text-primary hover:underline line-clamp-1">
                        {rule.ruleName}
                      </Link>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{rule.policyName}</div>
                    </div>
                    <span className="text-sm tabular-nums font-semibold shrink-0 text-foreground">{rule.triggerCount}</span>
                  </div>
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1.5 flex gap-2 flex-wrap">
                    {rule.approvedCount > 0 && (
                      <span className="text-[10px] text-green-400 tabular-nums">{rule.approvedCount} appr</span>
                    )}
                    {rule.deniedCount > 0 && (
                      <span className="text-[10px] text-red-400 tabular-nums">{rule.deniedCount} denied</span>
                    )}
                    {rule.needsReviewCount > 0 && (
                      <span className="text-[10px] text-slate-400 tabular-nums">{rule.needsReviewCount} review</span>
                    )}
                    {rule.escalatedCount > 0 && (
                      <span className="text-[10px] text-amber-400 tabular-nums">{rule.escalatedCount} esc</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Recent Decisions Feed ────────────────────────────────────────────────────

function RecentDecisionsFeed({ decisions }: { decisions?: DecisionList }) {
  const items: DecisionSummary[] = decisions?.decisions ?? [];

  return (
    <Card className="lg:col-span-2" data-testid="card-recent-decisions">
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="text-sm font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-muted-foreground" />
            Recent Decisions
          </span>
          <Link href="/decisions" className="text-xs text-primary hover:underline flex items-center gap-0.5">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">No decisions recorded yet</div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((d, idx) => (
              <li key={d.id} className="px-4 py-3 hover:bg-accent/20 transition-colors" data-testid={`decision-item-${idx}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <OutcomeBadge outcome={d.outcome} />
                      <span className="text-xs text-muted-foreground font-mono truncate">{d.actor}</span>
                      <span className="text-xs text-muted-foreground">→</span>
                      <span className="text-xs text-muted-foreground truncate">{d.action}</span>
                    </div>
                    {d.policyName && (
                      <div className="mt-1 text-[11px] text-muted-foreground">{d.policyName}</div>
                    )}
                    {(d.explanation || d.scenario) && (
                      <div className="mt-1 text-xs text-foreground/70 line-clamp-1">{d.explanation ?? d.scenario}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[11px] text-muted-foreground tabular-nums">{timeAgo(d.createdAt)}</span>
                    <Link href={`/decisions/${d.id}`} className="text-[11px] text-primary hover:underline">
                      Detail
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Coverage Gaps Panel ──────────────────────────────────────────────────────

const GAP_REASON_LABEL: Record<string, string> = {
  few_rules: "Too few rules",
  high_exceptions: "High exception rate",
  both: "Few rules + high exceptions",
};

function CoverageGapsPanel({ gaps }: { gaps?: CoverageGapItem[] }) {
  const items = gaps ?? [];

  return (
    <Card data-testid="card-coverage-gaps">
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-500" />
          Coverage Gaps
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">No coverage gaps detected</div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((gap, idx) => (
              <li key={gap.policyId} className="px-4 py-3 hover:bg-accent/20 transition-colors" data-testid={`gap-item-${idx}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/policies/${gap.policyId}`} className="text-sm font-medium hover:text-primary hover:underline truncate block">
                      {gap.policyName}
                    </Link>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{gap.organizationName}</div>
                    <div className="mt-1.5 text-[11px] text-amber-400 font-medium">{GAP_REASON_LABEL[gap.gapReason]}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs tabular-nums text-muted-foreground">{gap.publishedRuleCount} rules</div>
                    {gap.needsReviewCount7d > 0 && (
                      <div className="text-xs tabular-nums text-amber-400">{gap.needsReviewCount7d} reviews/7d</div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Rule Health Panel ────────────────────────────────────────────────────────

function RuleHealthPanel({ rules }: { rules?: RuleHealthItem[] }) {
  const items = rules ?? [];

  return (
    <Card data-testid="card-rule-health">
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          Rule Health — Unresolved Ambiguities and Edge Cases
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">All published rules are fully resolved</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="rule-health-table">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Rule</th>
                  <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Policy</th>
                  <th className="px-4 py-2.5 text-center text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Unresolved Ambig.</th>
                  <th className="px-4 py-2.5 text-center text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Unresolved Edge Cases</th>
                  <th className="px-4 py-2.5 text-center text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Conflict Signals</th>
                  <th className="px-4 py-2.5 text-center text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Human Overrides</th>
                  <th className="px-4 py-2.5 text-center text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Health Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((rule, idx) => {
                  const scoreColor = rule.healthScore > 6 ? "text-red-400" : rule.healthScore > 2 ? "text-amber-400" : "text-slate-400";
                  return (
                    <tr key={rule.ruleId} className="hover:bg-accent/20 transition-colors" data-testid={`health-row-${idx}`}>
                      <td className="px-4 py-3">
                        <Link href={`/rules/${rule.ruleId}?tab=analysis`} className="font-medium hover:text-primary hover:underline line-clamp-1">
                          {rule.ruleName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{rule.policyName}</td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        <span className={cn("font-semibold", rule.unresolvedAmbiguities > 0 ? "text-amber-400" : "text-muted-foreground")}>
                          {rule.unresolvedAmbiguities}
                        </span>
                        <span className="text-muted-foreground text-[11px]"> / {rule.totalAmbiguities}</span>
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        <span className={cn("font-semibold", rule.unresolvedEdgeCases > 0 ? "text-red-400" : "text-muted-foreground")}>
                          {rule.unresolvedEdgeCases}
                        </span>
                        <span className="text-muted-foreground text-[11px]"> / {rule.totalEdgeCases}</span>
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        <span className={cn("font-semibold", rule.conflictSignals > 0 ? "text-red-400" : "text-muted-foreground")}>
                          {rule.conflictSignals}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        <span className={cn("font-semibold", rule.humanOverrides > 1 ? "text-amber-400" : "text-muted-foreground")}>
                          {rule.humanOverrides}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn("font-bold tabular-nums text-base", scoreColor)}>{rule.healthScore}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export function DashboardPage() {
  const { data: summary } = useGetAnalyticsSummary(undefined, { query: { queryKey: getGetAnalyticsSummaryQueryKey(), refetchInterval: REFETCH_MS } });
  const { data: volume }  = useGetDecisionVolume({ query: { queryKey: getGetDecisionVolumeQueryKey(), refetchInterval: REFETCH_MS } });
  const { data: topRules } = useGetTopRules({ query: { queryKey: getGetTopRulesQueryKey(), refetchInterval: REFETCH_MS } });
  const { data: gaps }     = useGetCoverageGaps({ query: { queryKey: getGetCoverageGapsQueryKey(), refetchInterval: REFETCH_MS } });
  const { data: health }   = useGetRuleHealth({ query: { queryKey: getGetRuleHealthQueryKey(), refetchInterval: REFETCH_MS } });
  const { data: recent }   = useListDecisions({ limit: 10 }, { query: { queryKey: getListDecisionsQueryKey({ limit: 10 }), refetchInterval: REFETCH_MS } });

  const approvalSub = summary ? `${summary.approvalRate}% of ${summary.decisionsLast30d} decisions` : undefined;
  const exceptionSub = summary ? `needs review + escalated` : undefined;

  return (
    <AppLayout>
      <PageHeader
        title="Governance Overview"
        description="Live analytics across all policies, rules, and decisions. Auto-refreshes every 60 seconds."
      />
      <div className="p-6 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard testId="stat-decisions" icon={Activity} label="Decisions / 30d" value={summary?.decisionsLast30d ?? 0} accent="blue" />
          <StatCard testId="stat-approval" icon={CheckCircle2} label="Approval Rate" value={summary ? `${summary.approvalRate}%` : "—"} sub={approvalSub} accent="green" />
          <StatCard testId="stat-exception" icon={AlertTriangle} label="Exception Rate" value={summary ? `${summary.exceptionRate}%` : "—"} sub={exceptionSub} accent="amber" />
          <StatCard testId="stat-rules" icon={Scale} label="Active Rules" value={summary?.publishedRules ?? 0} sub={summary ? `${summary.draftRules} draft` : undefined} accent="blue" />
          <StatCard testId="stat-drafts" icon={FileText} label="Draft Rules" value={summary?.draftRules ?? 0} sub={summary ? `${summary.publishedRules} active` : undefined} accent="blue" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <DecisionVolumeChart days={volume?.days} total={volume?.total} />
          <TopRulesPanel rules={topRules?.rules} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <RecentDecisionsFeed decisions={recent} />
          <CoverageGapsPanel gaps={gaps?.gaps} />
        </div>

        <RuleHealthPanel rules={health?.rules} />
      </div>
    </AppLayout>
  );
}
