import { useState } from "react";
import { Link } from "wouter";
import { useListDecisions, useListPolicies } from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { CheckCircle, XCircle, AlertTriangle, HelpCircle, ChevronLeft, ChevronRight, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

type Outcome = "approved" | "denied" | "escalated" | "needs_review";

const OUTCOME_CONFIG: Record<Outcome, { label: string; icon: typeof CheckCircle; color: string; dot: string }> = {
  approved: { label: "Approved", icon: CheckCircle, color: "text-green-500", dot: "bg-green-500" },
  denied: { label: "Denied", icon: XCircle, color: "text-red-500", dot: "bg-red-500" },
  escalated: { label: "Escalated", icon: AlertTriangle, color: "text-amber-500", dot: "bg-amber-500" },
  needs_review: { label: "Needs Review", icon: HelpCircle, color: "text-slate-400", dot: "bg-slate-400" },
};

function OutcomeDot({ outcome }: { outcome: string }) {
  const conf = OUTCOME_CONFIG[outcome as Outcome];
  if (!conf) return <span className="text-muted-foreground text-xs">{outcome}</span>;
  const Icon = conf.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", conf.color)}>
      <Icon className="w-3.5 h-3.5" />
      {conf.label}
    </span>
  );
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

const PAGE_SIZE = 25;

export function DecisionsPage() {
  const [policyFilter, setPolicyFilter] = useState<string>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [page, setPage] = useState(1);

  const { data: policiesData } = useListPolicies();
  const policies = policiesData ?? [];

  const resetPage = () => setPage(1);

  const params = {
    ...(policyFilter !== "all" && { policyId: Number(policyFilter) }),
    ...(outcomeFilter !== "all" && { outcome: outcomeFilter as Outcome }),
    ...(actorFilter.trim() && { actor: actorFilter.trim() }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
    page,
    limit: PAGE_SIZE,
  };

  const { data, isLoading } = useListDecisions(params);
  const decisions = data?.decisions ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <AppLayout>
      <PageHeader
        title="Decision Audit Log"
        description="Immutable record of every governance decision made by the engine."
        actions={
          <Link href="/playground">
            <Button variant="outline" size="sm" data-testid="button-playground">
              <FlaskConical className="w-3.5 h-3.5 mr-1.5" /> Try Playground
            </Button>
          </Link>
        }
      />
      <div className="p-8 space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Filter</span>
          <Select value={policyFilter} onValueChange={(v) => { setPolicyFilter(v); resetPage(); }}>
            <SelectTrigger className="w-48" data-testid="filter-policy">
              <SelectValue placeholder="All policies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All policies</SelectItem>
              {policies.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={outcomeFilter} onValueChange={(v) => { setOutcomeFilter(v); resetPage(); }}>
            <SelectTrigger className="w-44" data-testid="filter-outcome">
              <SelectValue placeholder="All outcomes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outcomes</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
              <SelectItem value="escalated">Escalated</SelectItem>
              <SelectItem value="needs_review">Needs Review</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={actorFilter}
            onChange={(e) => { setActorFilter(e.target.value); resetPage(); }}
            placeholder="Filter by actor…"
            className="w-48 text-sm"
            data-testid="filter-actor"
          />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); resetPage(); }}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="filter-date-from"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); resetPage(); }}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="filter-date-to"
            />
          </div>
          {(policyFilter !== "all" || outcomeFilter !== "all" || actorFilter || dateFrom || dateTo) && (
            <button
              onClick={() => { setPolicyFilter("all"); setOutcomeFilter("all"); setActorFilter(""); setDateFrom(""); setDateTo(""); resetPage(); }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-clear-filters"
            >
              Clear
            </button>
          )}
          {total > 0 && (
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">{total} decision{total !== 1 ? "s" : ""}</span>
          )}
        </div>

        <Card>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b border-border text-left">
              <tr>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium w-10">#</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Actor / Action</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Policy</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Outcome</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Confidence</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && decisions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <p className="text-muted-foreground text-sm">No decisions recorded yet.</p>
                    <Link href="/playground">
                      <button className="mt-2 text-xs text-primary hover:underline">Try the playground to generate your first decision</button>
                    </Link>
                  </td>
                </tr>
              )}
              {decisions.map((d) => (
                <tr
                  key={d.id}
                  className="hover:bg-accent/30 transition-colors"
                  data-testid={`row-decision-${d.id}`}
                >
                  <td className="px-5 py-3 tabular-nums text-muted-foreground text-xs">{d.id}</td>
                  <td className="px-5 py-3">
                    <Link href={`/decisions/${d.id}`} className="text-foreground hover:text-primary font-medium">
                      {d.actor}
                    </Link>
                    <div className="text-xs text-muted-foreground mt-0.5 font-mono">{d.action}</div>
                    {d.scenario && (
                      <div className="text-xs text-muted-foreground/70 mt-0.5 truncate max-w-xs italic">{d.scenario}</div>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {d.policyName ? (
                      <span className="text-sm">{d.policyName}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs italic">—</span>
                    )}
                    {d.organizationName && (
                      <div className="text-xs text-muted-foreground mt-0.5">{d.organizationName}</div>
                    )}
                  </td>
                  <td className="px-5 py-3"><OutcomeDot outcome={d.outcome} /></td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", d.confidence >= 80 ? "bg-green-500" : d.confidence >= 50 ? "bg-amber-500" : "bg-slate-400")}
                          style={{ width: `${d.confidence}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">{d.confidence}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-xs tabular-nums text-muted-foreground">{formatDate(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Previous
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
