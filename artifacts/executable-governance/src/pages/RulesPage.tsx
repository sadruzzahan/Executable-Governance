import { useState } from "react";
import { Link } from "wouter";
import { useListRules } from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Can } from "@/lib/auth";
import { StatusBadge, OutcomeBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";

export function RulesPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const params = statusFilter !== "all" ? { status: statusFilter as "draft" | "published" | "archived" } : undefined;
  const { data: rules, isLoading } = useListRules(params);

  return (
    <AppLayout>
      <PageHeader
        title="Rules"
        description="All compiled governance rules across every policy."
        actions={
          <Link href="/rules/new">
            <Can action="rule.create">
              <Button data-testid="button-new-rule"><Plus className="w-4 h-4 mr-1" /> New Rule</Button>
            </Can>
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
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium w-16">Pri.</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Rule</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Outcome</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Status</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-right">Ver.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (<tr><td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">Loading…</td></tr>)}
              {!isLoading && (rules ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-accent/30 transition-colors" data-testid={`row-rule-${r.id}`}>
                  <td className="px-5 py-3 tabular-nums text-muted-foreground">{r.priority}</td>
                  <td className="px-5 py-3">
                    <Link href={`/rules/${r.id}`} className="text-foreground hover:text-primary font-medium">{r.name}</Link>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-2xl">{r.naturalLanguageText}</div>
                  </td>
                  <td className="px-5 py-3"><OutcomeBadge outcome={r.outcome} /></td>
                  <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">v{r.version}</td>
                </tr>
              ))}
              {!isLoading && (rules ?? []).length === 0 && (<tr><td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">No rules found</td></tr>)}
            </tbody>
          </table>
        </Card>
      </div>
    </AppLayout>
  );
}
