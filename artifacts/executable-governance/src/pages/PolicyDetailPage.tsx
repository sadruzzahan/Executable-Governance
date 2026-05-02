import { Link, useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPolicy,
  getGetPolicyQueryKey,
  getListPoliciesQueryKey,
  usePublishPolicy,
  useArchivePolicy,
  useDeletePolicy,
} from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { StatusBadge, OutcomeBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Plus, Archive, Send, Trash2 } from "lucide-react";

export function PolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: policy } = useGetPolicy(id, { query: { enabled: !!id, queryKey: getGetPolicyQueryKey(id) } });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetPolicyQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListPoliciesQueryKey() });
  };

  const publish = usePublishPolicy({ mutation: { onSuccess: invalidate } });
  const archive = useArchivePolicy({ mutation: { onSuccess: invalidate } });
  const del = useDeletePolicy({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPoliciesQueryKey() });
        setLocation("/policies");
      },
    },
  });

  if (!policy) {
    return (
      <AppLayout>
        <div className="p-8 text-muted-foreground">Loading…</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title={policy.name}
        description={policy.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/rules/new?policyId=${policy.id}`}>
              <Button variant="outline" data-testid="button-add-rule">
                <Plus className="w-4 h-4 mr-1" /> Add Rule
              </Button>
            </Link>
            {policy.status !== "published" && (
              <Button onClick={() => publish.mutate({ id })} data-testid="button-publish-policy">
                <Send className="w-4 h-4 mr-1" /> Publish
              </Button>
            )}
            {policy.status !== "archived" && (
              <Button variant="outline" onClick={() => archive.mutate({ id })} data-testid="button-archive-policy">
                <Archive className="w-4 h-4 mr-1" /> Archive
              </Button>
            )}
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => del.mutate({ id })}
              data-testid="button-delete-policy"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        }
      />
      <div className="p-8 space-y-6">
        <Link href="/policies" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to policies
        </Link>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Organization</div>
            <div className="mt-1 text-sm font-medium">{policy.organizationName}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Domain</div>
            <div className="mt-1 text-sm font-medium">{policy.domain}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Status</div>
            <div className="mt-1.5"><StatusBadge status={policy.status} /></div>
          </Card>
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Version</div>
            <div className="mt-1 text-sm font-medium tabular-nums">v{policy.version}</div>
          </Card>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Rules ({policy.rules.length})</h2>
          </div>
          <Card>
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border text-left">
                <tr>
                  <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium w-16">Pri.</th>
                  <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Rule</th>
                  <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Outcome</th>
                  <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Status</th>
                  <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-right">Ver.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {policy.rules.map((r) => (
                  <tr key={r.id} className="hover:bg-accent/30 transition-colors" data-testid={`row-rule-${r.id}`}>
                    <td className="px-5 py-3 tabular-nums text-muted-foreground">{r.priority}</td>
                    <td className="px-5 py-3">
                      <Link href={`/rules/${r.id}`} className="text-foreground hover:text-primary font-medium">
                        {r.name}
                      </Link>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-2xl">{r.naturalLanguageText}</div>
                    </td>
                    <td className="px-5 py-3"><OutcomeBadge outcome={r.outcome} /></td>
                    <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">v{r.version}</td>
                  </tr>
                ))}
                {policy.rules.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">No rules yet</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
