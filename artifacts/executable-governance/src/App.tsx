import { Switch, Route, Router as WouterRouter } from "wouter";
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

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/policies" component={PoliciesPage} />
      <Route path="/policies/new" component={NewPolicyPage} />
      <Route path="/policies/:id" component={PolicyDetailPage} />
      <Route path="/rules" component={RulesPage} />
      <Route path="/rules/new" component={NewRulePage} />
      <Route path="/rules/:id" component={RuleDetailPage} />
      <Route path="/users" component={UsersPage} />
      <Route path="/organizations" component={OrganizationsPage} />
      <Route component={NotFound} />
    </Switch>
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
