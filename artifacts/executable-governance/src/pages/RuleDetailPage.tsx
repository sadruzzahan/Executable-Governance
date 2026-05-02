import { useState, useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRule,
  getGetRuleQueryKey,
  usePublishRule,
  useDeleteRule,
  useUpdateRule,
  useGetRuleVersionDiff,
  getGetRuleVersionDiffQueryKey,
  getListRulesQueryKey,
} from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { StatusBadge, OutcomeBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StructuredRuleEditor, DEFAULT_STRUCTURED, type StructuredRule } from "@/components/StructuredRuleEditor";
import { ArrowLeft, Send, Trash2, History, Code2, FileText, Pencil, GitCompare } from "lucide-react";

function formatDate(d: string | Date) {
  return new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function toStructured(value: unknown): StructuredRule {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return {
      kind: typeof v.kind === "string" ? v.kind : DEFAULT_STRUCTURED.kind,
      field: typeof v.field === "string" ? v.field : DEFAULT_STRUCTURED.field,
      operator: typeof v.operator === "string" ? v.operator : DEFAULT_STRUCTURED.operator,
      value: typeof v.value === "number" || typeof v.value === "string" ? v.value : 0,
      currency: typeof v.currency === "string" ? v.currency : "",
      scope: typeof v.scope === "string" ? v.scope : "",
    };
  }
  return DEFAULT_STRUCTURED;
}

export function RuleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: rule } = useGetRule(id, { query: { enabled: !!id, queryKey: getGetRuleQueryKey(id) } });

  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<"approved" | "denied" | "escalated" | "needs_review">("approved");
  const [priority, setPriority] = useState("10");
  const [structured, setStructured] = useState<StructuredRule>(DEFAULT_STRUCTURED);
  const [changeNote, setChangeNote] = useState("");

  useEffect(() => {
    if (!rule) return;
    setName(rule.name);
    setText(rule.naturalLanguageText);
    setOutcome(rule.outcome);
    setPriority(String(rule.priority));
    setStructured(toStructured(rule.structuredRepresentation));
  }, [rule]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetRuleQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
  };

  const update = useUpdateRule({
    mutation: {
      onSuccess: () => {
        invalidate();
        setEditOpen(false);
        setChangeNote("");
      },
    },
  });
  const publish = usePublishRule({ mutation: { onSuccess: invalidate } });
  const del = useDeleteRule({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
        setLocation(rule?.policyId ? `/policies/${rule.policyId}` : "/rules");
      },
    },
  });

  const [diffFrom, setDiffFrom] = useState<number | null>(null);
  const [diffTo, setDiffTo] = useState<number | null>(null);
  const diffEnabled = !!id && diffFrom != null && diffTo != null && diffFrom !== diffTo;
  const diffParams = { from: diffFrom ?? 0, to: diffTo ?? 0 };
  const { data: diff } = useGetRuleVersionDiff(
    id,
    diffParams,
    { query: { enabled: diffEnabled, queryKey: getGetRuleVersionDiffQueryKey(id, diffParams) } },
  );

  if (!rule) {
    return (
      <AppLayout>
        <div className="p-8 text-muted-foreground">Loading…</div>
      </AppLayout>
    );
  }

  const onSave = () => {
    const cleaned: Record<string, unknown> = {
      kind: structured.kind,
      field: structured.field,
      operator: structured.operator,
      value: structured.value,
    };
    if (structured.currency) cleaned.currency = structured.currency;
    if (structured.scope) cleaned.scope = structured.scope;
    update.mutate({
      id,
      data: {
        name,
        naturalLanguageText: text,
        outcome,
        priority: Number(priority),
        structuredRepresentation: cleaned,
        changeNote: changeNote || null,
      },
    });
  };

  return (
    <AppLayout>
      <PageHeader
        title={rule.name}
        description={rule.policyName ? `Part of ${rule.policyName}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)} data-testid="button-edit-rule">
              <Pencil className="w-4 h-4 mr-1" /> Edit
            </Button>
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
          <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
            <History className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Version History</h3>
            <span className="text-xs text-muted-foreground">({rule.versions.length})</span>
            {rule.versions.length >= 2 && (
              <div className="ml-auto flex items-center gap-2">
                <GitCompare className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Diff</span>
                <Select value={diffFrom != null ? String(diffFrom) : ""} onValueChange={(v) => setDiffFrom(Number(v))}>
                  <SelectTrigger className="w-20 h-7 text-xs" data-testid="select-diff-from"><SelectValue placeholder="from" /></SelectTrigger>
                  <SelectContent>
                    {rule.versions.map((v) => (<SelectItem key={v.version} value={String(v.version)}>v{v.version}</SelectItem>))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">→</span>
                <Select value={diffTo != null ? String(diffTo) : ""} onValueChange={(v) => setDiffTo(Number(v))}>
                  <SelectTrigger className="w-20 h-7 text-xs" data-testid="select-diff-to"><SelectValue placeholder="to" /></SelectTrigger>
                  <SelectContent>
                    {rule.versions.map((v) => (<SelectItem key={v.version} value={String(v.version)}>v{v.version}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {diffEnabled && diff && (
            <div className="px-5 py-4 border-b border-border bg-muted/20" data-testid="diff-result">
              {diff.changes.length === 0 ? (
                <div className="text-xs text-muted-foreground">No differences between v{diffFrom} and v{diffTo}.</div>
              ) : (
                <ul className="space-y-3">
                  {diff.changes.map((c) => (
                    <li key={c.field} className="text-xs">
                      <div className="font-medium text-foreground mb-1">{c.field}</div>
                      <div className="grid grid-cols-2 gap-3 font-mono">
                        <div className="rounded bg-red-500/10 border border-red-500/20 p-2 text-red-700 dark:text-red-300 break-all">
                          {typeof c.before === "string" ? c.before : JSON.stringify(c.before, null, 2)}
                        </div>
                        <div className="rounded bg-emerald-500/10 border border-emerald-500/20 p-2 text-emerald-700 dark:text-emerald-300 break-all">
                          {typeof c.after === "string" ? c.after : JSON.stringify(c.after, null, 2)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Rule</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="edit-input-name" /></div>
            <div className="space-y-2"><Label>Plain-language rule</Label><Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} data-testid="edit-input-text" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Outcome</Label>
                <Select value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)}>
                  <SelectTrigger data-testid="edit-select-outcome"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="denied">Denied</SelectItem>
                    <SelectItem value="escalated">Escalated</SelectItem>
                    <SelectItem value="needs_review">Needs Review</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Priority</Label><Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} data-testid="edit-input-priority" /></div>
            </div>
            <StructuredRuleEditor value={structured} onChange={setStructured} />
            <div className="space-y-2"><Label>Change note (optional)</Label><Input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="What changed and why" data-testid="edit-input-changenote" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={onSave} disabled={update.isPending} data-testid="button-save-rule">
              {update.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
