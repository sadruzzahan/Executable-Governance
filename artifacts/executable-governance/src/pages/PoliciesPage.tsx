import { useState } from "react";
import { Link } from "wouter";
import { useListPolicies } from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileText } from "lucide-react";

export function PoliciesPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const params = statusFilter !== "all" ? { status: statusFilter as "draft" | "published" | "archived" } : undefined;
  const { data: policies, isLoading } = useListPolicies(params);

  return (
    <AppLayout>
      <PageHeader
        title="Policies"
        description="All governance policies across your organizations."
        actions={
          <Link href="/policies/new">
            <Button data-testid="button-new-policy">
              <Plus className="w-4 h-4 mr-1" /> New Policy
            </Button>
          </Link>
        }
      />
      <div className="p-8 space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Status</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40" data-testid="filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b border-border text-left">
              <tr>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Policy</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Organization</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Domain</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Status</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-right">Rules</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-right">Version</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && (policies ?? []).map((p) => (
                <tr key={p.id} className="hover:bg-accent/30 transition-colors" data-testid={`row-policy-${p.id}`}>
                  <td className="px-5 py-3">
                    <Link href={`/policies/${p.id}`} className="flex items-center gap-2 text-foreground hover:text-primary font-medium">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                      {p.name}
                    </Link>
                    {p.description && <div className="text-xs text-muted-foreground mt-0.5 ml-5.5 truncate max-w-md">{p.description}</div>}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{p.organizationName}</td>
                  <td className="px-5 py-3"><span className="text-xs px-2 py-0.5 rounded bg-muted text-foreground">{p.domain}</span></td>
                  <td className="px-5 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    <span className="text-foreground font-medium">{p.publishedRuleCount}</span>
                    <span className="text-muted-foreground"> / {p.ruleCount}</span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">v{p.version}</td>
                </tr>
              ))}
              {!isLoading && (policies ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">No policies found</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </AppLayout>
  );
}
