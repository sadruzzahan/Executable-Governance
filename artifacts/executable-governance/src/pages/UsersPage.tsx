import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers,
  useListOrganizations,
  useCreateUser,
  useDeleteUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";

const roleColors: Record<string, string> = {
  admin: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  approver: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  editor: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  reader: "bg-muted text-muted-foreground border-border",
};

export function UsersPage() {
  const queryClient = useQueryClient();
  const { data: users } = useListUsers();
  const { data: orgs } = useListOrganizations();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("reader");
  const [organizationId, setOrganizationId] = useState("");

  const create = useCreateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setOpen(false);
        setName(""); setEmail(""); setRole("reader"); setOrganizationId("");
      },
    },
  });
  const del = useDeleteUser({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }),
    },
  });

  const orgName = (id: number) => orgs?.find((o) => o.id === id)?.name ?? "—";

  return (
    <AppLayout>
      <PageHeader
        title="Users"
        description="People who can author, approve, or read governance rules."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-user"><Plus className="w-4 h-4 mr-1" /> New User</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Organization</Label>
                  <Select value={organizationId} onValueChange={setOrganizationId}>
                    <SelectTrigger data-testid="select-organization"><SelectValue placeholder="Select organization" /></SelectTrigger>
                    <SelectContent>
                      {(orgs ?? []).map((o) => (<SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-name" /></div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" /></div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger data-testid="select-role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reader">Reader</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="approver">Approver</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => create.mutate({ data: { organizationId: Number(organizationId), name, email, role: role as "reader" | "editor" | "approver" | "admin" } })}
                  disabled={!organizationId || !name || !email}
                  data-testid="button-submit-user"
                >Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="p-8">
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b border-border text-left">
              <tr>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Name</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Email</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Organization</th>
                <th className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Role</th>
                <th className="px-5 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(users ?? []).map((u) => (
                <tr key={u.id} className="hover:bg-accent/30 transition-colors" data-testid={`row-user-${u.id}`}>
                  <td className="px-5 py-3 font-medium">{u.name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-5 py-3 text-muted-foreground">{orgName(u.organizationId)}</td>
                  <td className="px-5 py-3"><Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${roleColors[u.role] ?? ""}`}>{u.role}</Badge></td>
                  <td className="px-5 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => del.mutate({ id: u.id })} data-testid={`button-delete-user-${u.id}`}><Trash2 className="w-3.5 h-3.5 text-muted-foreground" /></Button>
                  </td>
                </tr>
              ))}
              {(users ?? []).length === 0 && (<tr><td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">No users yet</td></tr>)}
            </tbody>
          </table>
        </Card>
      </div>
    </AppLayout>
  );
}
