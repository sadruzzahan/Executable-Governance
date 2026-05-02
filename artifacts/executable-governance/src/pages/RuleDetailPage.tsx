import { Link, useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRule,
  getGetRuleQueryKey,
  usePublishRule,
  useDeleteRule,
  getListRulesQueryKey,
} from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { StatusBadge, OutcomeBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Send, Trash2, History, Code2, FileText } from "lucide-react";

function formatDate(d: string | Date) {
  return new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function RuleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: rule } = useGetRule(id, { query: { enabled: !!id, queryKey: getGetRuleQueryKey(id) } });

  const publish = usePublishRule({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRuleQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
      },
    },
  });
  const del = useDeleteRule({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
        setLocation("/policies");
      },
    },
  });

  if (!rule) {
    return (
      <AppLayout>
        <div className="p-8 text-muted-foreground">Loading…</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title={rule.name}
        description={rule.policyName ? `Part of ${rule.policyName}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            {rule.status !== "published" && (
              <Button onClick={() => publish.mutate({ id })} data-testid="button-publish-rule">
                <Send className="w-4 h-4 mr-1" /> Publish
              </Button>
            )}
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => del.mutate({ id })}
              data-testid="button-delete-rule"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        }
      />
      <div className="p-8 space-y-6">
        <Link href={`/policies/${rule.policyId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to policy
        </Link>

        <div className="flex items-center gap-3 flex-wrap">
          <OutcomeBadge outcome={rule.outcome} />
          <StatusBadge status={rule.status} />
          <span className="text-xs text-muted-foreground tabular-nums">v{rule.version}</span>
          <span className="text-xs text-muted-foreground">Priority {rule.priority}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-2 mb-3">
              <FileText className="w-3.5 h-3.5" /> Natural Language
            </div>
            <p className="text-sm leading-relaxed text-foreground" data-testid="rule-natural-text">{rule.naturalLanguageText}</p>
          </Card>
          <Card className="p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-2 mb-3">
              <Code2 className="w-3.5 h-3.5" /> Structured Representation
            </div>
            <pre className="text-xs font-mono bg-muted/50 rounded p-3 overflow-x-auto text-foreground" data-testid="rule-structured">
{JSON.stringify(rule.structuredRepresentation, null, 2)}
            </pre>
          </Card>
        </div>

        <Card>
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Version History</h3>
            <span className="text-xs text-muted-foreground">({rule.versions.length})</span>
          </div>
          <ul className="divide-y divide-border">
            {rule.versions.map((v) => (
              <li key={v.id} className="px-5 py-3 flex items-start gap-4" data-testid={`version-${v.version}`}>
                <div className="text-xs font-mono px-2 py-0.5 bg-muted rounded tabular-nums shrink-0">v{v.version}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground">{v.naturalLanguageText}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {v.changedBy ?? "system"} · {v.changeNote ?? "no note"} · {formatDate(v.createdAt)}
                  </div>
                </div>
                <OutcomeBadge outcome={v.outcome} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppLayout>
  );
}
