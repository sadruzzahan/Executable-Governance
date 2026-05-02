import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateRule, useListPolicies, getListRulesQueryKey, getGetPolicyQueryKey } from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StructuredRuleEditor, DEFAULT_STRUCTURED, type StructuredRule } from "@/components/StructuredRuleEditor";

export function NewRulePage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const queryClient = useQueryClient();
  const { data: policies } = useListPolicies();

  const initialPolicyId = new URLSearchParams(search).get("policyId") ?? "";
  const [policyId, setPolicyId] = useState<string>(initialPolicyId);
  const [name, setName] = useState("");
  const [naturalLanguageText, setNaturalLanguageText] = useState("");
  const [outcome, setOutcome] = useState("approved");
  const [priority, setPriority] = useState("10");
  const [structured, setStructured] = useState<StructuredRule>(DEFAULT_STRUCTURED);

  const create = useCreateRule({
    mutation: {
      onSuccess: (rule) => {
        queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
        if (rule.policyId) {
          queryClient.invalidateQueries({ queryKey: getGetPolicyQueryKey(rule.policyId) });
        }
        setLocation(`/rules/${rule.id}`);
      },
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!policyId || !name.trim() || !naturalLanguageText.trim()) return;
    const cleanedStructured: Record<string, unknown> = {
      kind: structured.kind,
      field: structured.field,
      operator: structured.operator,
      value: structured.value,
    };
    if (structured.currency) cleanedStructured.currency = structured.currency;
    if (structured.scope) cleanedStructured.scope = structured.scope;
    create.mutate({
      data: {
        policyId: Number(policyId),
        name: name.trim(),
        naturalLanguageText: naturalLanguageText.trim(),
        outcome: outcome as "approved" | "denied" | "escalated" | "needs_review",
        priority: Number(priority),
        structuredRepresentation: cleanedStructured,
      },
    });
  };

  return (
    <AppLayout>
      <PageHeader title="New Rule" description="Write the rule in plain English and define its structured condition." />
      <div className="p-8 max-w-3xl">
        <Card className="p-6">
          <form onSubmit={onSubmit} className="space-y-5" data-testid="form-new-rule">
            <div className="space-y-2">
              <Label htmlFor="policy">Policy</Label>
              <Select value={policyId} onValueChange={setPolicyId}>
                <SelectTrigger id="policy" data-testid="select-policy"><SelectValue placeholder="Select a policy" /></SelectTrigger>
                <SelectContent>
                  {(policies ?? []).map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name} <span className="text-muted-foreground">({p.organizationName})</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Rule Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hotel cap per night" data-testid="input-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="text">Plain-language rule</Label>
              <Textarea id="text" rows={4} value={naturalLanguageText} onChange={(e) => setNaturalLanguageText(e.target.value)} placeholder="e.g. Hotel charges up to $250 per night are approved without manager review." data-testid="input-text" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="outcome">Outcome</Label>
                <Select value={outcome} onValueChange={setOutcome}>
                  <SelectTrigger id="outcome" data-testid="select-outcome"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="denied">Denied</SelectItem>
                    <SelectItem value="escalated">Escalated</SelectItem>
                    <SelectItem value="needs_review">Needs Review</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Input id="priority" type="number" value={priority} onChange={(e) => setPriority(e.target.value)} data-testid="input-priority" />
              </div>
            </div>
            <StructuredRuleEditor value={structured} onChange={setStructured} />
            <div className="flex items-center gap-2 pt-2">
              <Button type="submit" disabled={create.isPending || !policyId || !name.trim() || !naturalLanguageText.trim()} data-testid="button-submit">
                {create.isPending ? "Creating…" : "Create Rule"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setLocation("/policies")} data-testid="button-cancel">Cancel</Button>
            </div>
          </form>
        </Card>
      </div>
    </AppLayout>
  );
}
