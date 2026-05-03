import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { DashboardPage } from "@/pages/DashboardPage";
import { PoliciesPage } from "@/pages/PoliciesPage";
import { PolicyDetailPage } from "@/pages/PolicyDetailPage";
import { NewPolicyPage } from "@/pages/NewPolicyPage";
import { RulesPage } from "@/pages/RulesPage";
import { RuleDetailPage } from "@/pages/RuleDetailPage";
import { NewRulePage } from "@/pages/NewRulePage";
import { UsersPage } from "@/pages/UsersPage";
import { OrganizationsPage } from "@/pages/OrganizationsPage";
import { PlaygroundPage } from "@/pages/PlaygroundPage";
import { DecisionsPage } from "@/pages/DecisionsPage";
import { DecisionDetailPage } from "@/pages/DecisionDetailPage";
import { LoginPage } from "@/pages/LoginPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { VerifyEmailPage } from "@/pages/VerifyEmailPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { useMe } from "@/lib/auth";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

const PUBLIC_ROUTES = ["/login", "/reset-password", "/verify-email"];

function Authed({ children }: { children: ReactNode }) {
  const me = useMe();
  const [location, navigate] = useLocation();
  const isPublic = PUBLIC_ROUTES.some((p) => location === p || location.startsWith(`${p}?`));

  useEffect(() => {
    if (me.isLoading) return;
    if (!me.data && !isPublic) navigate("/login");
    if (me.data && location === "/login") navigate("/");
  }, [me.data, me.isLoading, isPublic, location, navigate]);

  if (me.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (!me.data && !isPublic) return null;
  return <>{children}</>;
}

function Router() {
  return (
    <Authed>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route path="/verify-email" component={VerifyEmailPage} />
        <Route path="/" component={DashboardPage} />
        <Route path="/policies" component={PoliciesPage} />
        <Route path="/policies/new" component={NewPolicyPage} />
        <Route path="/policies/:id" component={PolicyDetailPage} />
        <Route path="/rules" component={RulesPage} />
        <Route path="/rules/new" component={NewRulePage} />
        <Route path="/rules/:id" component={RuleDetailPage} />
        <Route path="/users" component={UsersPage} />
        <Route path="/organizations" component={OrganizationsPage} />
        <Route path="/playground" component={PlaygroundPage} />
        <Route path="/decisions" component={DecisionsPage} />
        <Route path="/decisions/:id" component={DecisionDetailPage} />
        <Route path="/settings"><SettingsPage section="account" /></Route>
        <Route path="/settings/account"><SettingsPage section="account" /></Route>
        <Route path="/settings/password"><SettingsPage section="password" /></Route>
        <Route path="/settings/security"><SettingsPage section="security" /></Route>
        <Route path="/settings/sessions"><SettingsPage section="sessions" /></Route>
        <Route path="/settings/danger"><SettingsPage section="danger" /></Route>
        <Route component={NotFound} />
      </Switch>
    </Authed>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
