import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOrganizations,
  useCreateOrganization,
  useDeleteOrganization,
  getListOrganizationsQueryKey,
} from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Building2 } from "lucide-react";

export function OrganizationsPage() {
  const queryClient = useQueryClient();
  const { data: orgs } = useListOrganizations();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [industry, setIndustry] = useState("");

  const create = useCreateOrganization({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrganizationsQueryKey() });
        setOpen(false);
        setName(""); setDescription(""); setIndustry("");
      },
    },
  });
  const del = useDeleteOrganization({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListOrganizationsQueryKey() }) },
  });

  return (
    <AppLayout>
      <PageHeader
        title="Organizations"
        description="Tenants in the governance platform. Each has its own policies, rules, and users."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button data-testid="button-new-organization"><Plus className="w-4 h-4 mr-1" /> New Organization</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Organization</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-name" /></div>
                <div className="space-y-2"><Label>Industry</Label><Input value={industry} onChange={(e) => setIndustry(e.target.value)} data-testid="input-industry" /></div>
                <div className="space-y-2"><Label>Description</Label><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-description" /></div>
              </div>
              <DialogFooter>
                <Button onClick={() => create.mutate({ data: { name, description: description || undefined, industry: industry || undefined } })} disabled={!name} data-testid="button-submit-organization">Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(orgs ?? []).map((o) => (
            <Card key={o.id} className="p-5" data-testid={`card-organization-${o.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-semibold truncate">{o.name}</div>
                    {o.industry && <div className="text-xs text-muted-foreground mt-0.5">{o.industry}</div>}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => del.mutate({ id: o.id })} data-testid={`button-delete-organization-${o.id}`}><Trash2 className="w-3.5 h-3.5 text-muted-foreground" /></Button>
              </div>
              {o.description && <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{o.description}</p>}
            </Card>
          ))}
          {(orgs ?? []).length === 0 && (
            <div className="col-span-full text-center text-muted-foreground py-10">No organizations yet</div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
