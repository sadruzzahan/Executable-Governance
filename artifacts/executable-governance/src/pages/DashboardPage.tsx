import { useGetAnalyticsSummary, useGetRecentActivity, useGetPolicyBreakdown } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { Building2, FileText, Scale, Users, Activity, TrendingUp } from "lucide-react";
import { Link } from "wouter";

function StatCard({ icon: Icon, label, value, sub, testId }: { icon: typeof Building2; label: string; value: number | string; sub?: string; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
            {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
          </div>
          <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function timeAgo(d: string | Date) {
  const date = new Date(d);
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

const activityLabels: Record<string, string> = {
  rule_created: "Rule created",
  rule_updated: "Rule updated",
  rule_published: "Rule published",
  policy_created: "Policy created",
  policy_published: "Policy published",
  policy_archived: "Policy archived",
};

export function DashboardPage() {
  const { data: summary } = useGetAnalyticsSummary();
  const { data: activity } = useGetRecentActivity({ limit: 12 });
  const { data: breakdown } = useGetPolicyBreakdown();

  return (
    <AppLayout>
      <PageHeader
        title="Governance Overview"
        description="Real-time view of policies, rules, and decisions across all organizations."
      />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard testId="stat-organizations" icon={Building2} label="Organizations" value={summary?.totalOrganizations ?? "—"} />
          <StatCard testId="stat-policies" icon={FileText} label="Policies" value={summary?.totalPolicies ?? "—"} sub={summary ? `${summary.publishedPolicies} published · ${summary.draftPolicies} draft` : undefined} />
          <StatCard testId="stat-rules" icon={Scale} label="Rules" value={summary?.totalRules ?? "—"} sub={summary ? `${summary.publishedRules} published · ${summary.draftRules} draft` : undefined} />
          <StatCard testId="stat-users" icon={Users} label="Users" value={summary?.totalUsers ?? "—"} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2" data-testid="card-recent-activity">
            <CardHeader className="border-b border-border pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-muted-foreground" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {(activity ?? []).map((item, idx) => (
                  <li key={`${item.entityType}-${item.id}-${idx}`} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-accent/30 transition-colors" data-testid={`activity-item-${idx}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{activityLabels[item.type] ?? item.type}</div>
                      <div className="mt-0.5 text-sm text-foreground truncate">
                        <Link href={item.entityType === "rule" ? `/rules/${item.entityId}` : `/policies/${item.entityId}`} className="hover:text-primary hover:underline">
                          {item.entityName}
                        </Link>
                        {item.policyName && (
                          <span className="text-muted-foreground"> · {item.policyName}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{item.organizationName}</div>
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums shrink-0">{timeAgo(item.createdAt)}</div>
                  </li>
                ))}
                {(activity ?? []).length === 0 && (
                  <li className="px-5 py-10 text-center text-sm text-muted-foreground">No activity yet</li>
                )}
              </ul>
            </CardContent>
          </Card>

          <Card data-testid="card-policy-breakdown">
            <CardHeader className="border-b border-border pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                Policy Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-5">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">By Status</div>
                <div className="space-y-2">
                  {breakdown && (["published", "draft", "archived"] as const).map((s) => {
                    const count = breakdown.byStatus[s];
                    const pct = breakdown.totalPolicies > 0 ? Math.round((count / breakdown.totalPolicies) * 100) : 0;
                    return (
                      <div key={s} className="flex items-center gap-3">
                        <div className="w-20"><StatusBadge status={s} /></div>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-sm tabular-nums w-10 text-right text-foreground font-medium">{count}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">By Domain</div>
                <ul className="space-y-1.5">
                  {(breakdown?.byDomain ?? []).map((d) => (
                    <li key={d.domain} className="flex items-center justify-between text-sm">
                      <span className="text-foreground">{d.domain}</span>
                      <span className="text-muted-foreground tabular-nums">{d.count} <span className="text-xs">({d.publishedCount} pub)</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
