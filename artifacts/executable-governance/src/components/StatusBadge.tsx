import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "draft" | "published" | "archived";
type Outcome = "approved" | "denied" | "escalated" | "needs_review";

const statusStyles: Record<Status, string> = {
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  published: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  archived: "bg-muted text-muted-foreground border-border",
};

const outcomeStyles: Record<Outcome, string> = {
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  denied: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  escalated: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  needs_review: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
};

const outcomeLabels: Record<Outcome, string> = {
  approved: "Approved",
  denied: "Denied",
  escalated: "Escalated",
  needs_review: "Needs Review",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = statusStyles[status as Status] ?? "bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("font-medium uppercase text-[10px] tracking-wider", cls)} data-testid={`status-${status}`}>
      {status}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const cls = outcomeStyles[outcome as Outcome] ?? "bg-muted text-muted-foreground";
  const label = outcomeLabels[outcome as Outcome] ?? outcome;
  return (
    <Badge variant="outline" className={cn("font-medium text-xs", cls)} data-testid={`outcome-${outcome}`}>
      {label}
    </Badge>
  );
}
