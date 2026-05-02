import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreatePolicy, useListOrganizations, getListPoliciesQueryKey } from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function NewPolicyPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: orgs } = useListOrganizations();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState("Expense");
  const [organizationId, setOrganizationId] = useState<string>("");

  const create = useCreatePolicy({
    mutation: {
      onSuccess: (policy) => {
        queryClient.invalidateQueries({ queryKey: getListPoliciesQueryKey() });
        setLocation(`/policies/${policy.id}`);
      },
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId || !name.trim()) return;
    create.mutate({
      data: {
        organizationId: Number(organizationId),
        name: name.trim(),
        description: description.trim() || undefined,
        domain,
      },
    });
  };

  return (
    <AppLayout>
      <PageHeader title="New Policy" description="Create a new governance policy. Add rules afterwards on the policy detail page." />
      <div className="p-8 max-w-2xl">
        <Card className="p-6">
          <form onSubmit={onSubmit} className="space-y-5" data-testid="form-new-policy">
            <div className="space-y-2">
              <Label htmlFor="org">Organization</Label>
              <Select value={organizationId} onValueChange={setOrganizationId}>
                <SelectTrigger id="org" data-testid="select-organization"><SelectValue placeholder="Select organization" /></SelectTrigger>
                <SelectContent>
                  {(orgs ?? []).map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Policy Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Travel & Lodging Policy" data-testid="input-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="domain">Domain</Label>
              <Select value={domain} onValueChange={setDomain}>
                <SelectTrigger id="domain" data-testid="select-domain"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Expense">Expense</SelectItem>
                  <SelectItem value="Procurement">Procurement</SelectItem>
                  <SelectItem value="HR">HR</SelectItem>
                  <SelectItem value="Compliance">Compliance</SelectItem>
                  <SelectItem value="Security">Security</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What does this policy govern?" data-testid="input-description" />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button type="submit" disabled={create.isPending || !organizationId || !name.trim()} data-testid="button-submit">
                {create.isPending ? "Creating…" : "Create Policy"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setLocation("/policies")} data-testid="button-cancel">Cancel</Button>
            </div>
          </form>
        </Card>
      </div>
    </AppLayout>
  );
}
