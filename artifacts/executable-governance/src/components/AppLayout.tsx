import { Link, useLocation } from "wouter";
import { type ReactNode } from "react";
import {
  LayoutDashboard,
  FileText,
  Scale,
  Users,
  Building2,
  ShieldCheck,
  FlaskConical,
  ListChecks,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMe, useLogout } from "@/lib/auth";
import type { Action } from "@workspace/db";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { VerifyEmailBanner } from "@/pages/SettingsPage";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  testId: string;
  /** Capability required to surface this entry; omitted = always shown */
  requires?: Action;
};

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
  { href: "/policies", label: "Policies", icon: FileText, testId: "nav-policies", requires: "policy.read" },
  { href: "/rules", label: "Rules", icon: Scale, testId: "nav-rules", requires: "rule.read" },
  { href: "/organizations", label: "Organizations", icon: Building2, testId: "nav-organizations", requires: "organization.read" },
  { href: "/users", label: "Users", icon: Users, testId: "nav-users", requires: "user.read" },
  { href: "/decisions", label: "Decisions", icon: ListChecks, testId: "nav-decisions", requires: "decision.read" },
  { href: "/playground", label: "Playground", icon: FlaskConical, testId: "nav-playground", requires: "decision.evaluate" },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const me = useMe();
  const logout = useLogout();
  const qc = useQueryClient();

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    return location === href || location.startsWith(href + "/");
  };

  const onLogout = async () => {
    try { await logout.mutateAsync(); } catch { /* ignore */ }
    qc.clear();
    navigate("/login");
  };

  const initials = me.data?.user.name
    ?.split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() ?? "?";

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col">
        <div className="px-5 h-16 flex items-center gap-2 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-md bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Executable</div>
            <div className="text-[11px] text-sidebar-foreground/60 uppercase tracking-wider">Governance</div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems
            .filter((item) => !item.requires || (me.data?.capabilities?.includes(item.requires) ?? false))
            .map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={item.testId}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-3 border-t border-sidebar-border">
          {me.data ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-sidebar-accent/50 transition-colors"
                  data-testid="user-menu-trigger"
                >
                  <div className="w-7 h-7 rounded-full bg-sidebar-accent text-sidebar-accent-foreground text-[11px] font-semibold flex items-center justify-center overflow-hidden shrink-0">
                    {me.data.user.avatarUrl ? (
                      <img src={me.data.user.avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      initials
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="text-xs font-medium truncate">{me.data.user.name}</div>
                    <div className="text-[10px] text-sidebar-foreground/60 truncate uppercase tracking-wider">
                      {me.data.user.role}
                    </div>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {me.data.user.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings/account" data-testid="menu-settings">
                    <Settings className="w-4 h-4 mr-2" /> Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onLogout} data-testid="menu-logout">
                  <LogOut className="w-4 h-4 mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="px-2 py-2 text-[11px] text-sidebar-foreground/50">v0.1 · Compliance Workstation</div>
          )}
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-x-auto">
        <VerifyEmailBanner />
        {children}
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="border-b border-border bg-card/40 px-8 py-6 flex items-start justify-between gap-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground" data-testid="page-title">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{description}</p>
        )}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}
