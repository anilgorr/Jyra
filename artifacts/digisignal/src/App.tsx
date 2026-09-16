import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { Loader2 } from 'lucide-react';
import { useGetCurrentUser } from '@workspace/api-client-react';

import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, SignInPage, SignUpPage, useAuthSession } from '@/lib/auth';
import { queryClient } from '@/lib/queryClient';

import { Layout } from './components/layout/layout';
import Landing from './pages/landing';
import Today from './pages/today';
import Onboarding from './pages/onboarding';
import Settings from './pages/settings';
import BusinessTwinPage from './pages/business-twin';
import IcpPage from './pages/icp';
import CompaniesPage from './pages/companies/index';
import ScreeningPage from '@/pages/screening';
import CompanyIntelligencePage from './pages/company-intelligence';
import ProviderDiagnostics from './pages/provider-diagnostics';
import Research from './pages/research';
import Signals from './pages/signals';
import Changes from './pages/changes';
import MarketReadinessPage from './pages/market-readiness/index';
import MarketReadinessCampaignPage from './pages/market-readiness/campaign';
import Opportunities from './pages/opportunities';
import Outcomes from './pages/outcomes';
import Learning from './pages/learning';
import AdminQualityPage from './pages/admin-quality';
import AdminAccessPage from './pages/admin-access';
import { WorkspaceProvider } from './context/workspace-context';
import PlanPage from "@/pages/plan";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function AuthLoading() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background" data-testid="auth-loading">
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
    </div>
  );
}

function HomeRedirect() {
  const { isSignedIn } = useAuthSession();
  return isSignedIn ? <Redirect to="/today" /> : <Landing />;
}

/** The access-gate refusal, if that is what this error is. */
function accessDenial(error: unknown): { code: string; message: string } | null {
  const candidate = error as { status?: number; data?: { code?: string; error?: string } } | null;
  if (!candidate || candidate.status !== 403) return null;
  const code = candidate.data?.code;
  if (code !== "not_invited" && code !== "suspended" && code !== "no_email") return null;
  return { code, message: candidate.data?.error ?? "You do not have access to JYRA yet." };
}

function AuthenticatedRoutes() {
  const [location] = useLocation();
  const { data: user, isLoading, isError, error } = useGetCurrentUser();

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  /* The door. A 403 on /me with an access code means Clerk let them in and we
   * did not: JYRA is invite-only. Say so plainly, with the server's own
   * wording, instead of the generic "workspace unavailable" a network fault
   * gets - a person who was not invited should not be told to refresh. */
  const denial = isError ? accessDenial(error) : null;
  if (denial) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-center">
        <div className="max-w-md">
          <h1 className="font-display text-2xl font-semibold">
            {denial.code === "suspended" ? "This account is paused" : "JYRA is invite-only right now"}
          </h1>
          <p className="mt-2 text-muted-foreground">{denial.message}</p>
          <p className="mt-6 text-sm text-muted-foreground">
            Signed in with the wrong account?{' '}
            <a href="/sign-in" className="underline">Switch account</a>
          </p>
        </div>
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-center">
        <div>
          <h1 className="font-display text-2xl font-semibold">Workspace unavailable</h1>
          <p className="mt-2 text-muted-foreground">Refresh the page to reconnect your authenticated session.</p>
        </div>
      </div>
    );
  }

  if (user.organizationCount === 0 && location !== '/onboarding') {
    return <Redirect to="/onboarding" />;
  }

  if (user.organizationCount > 0 && location === '/onboarding') {
    return <Redirect to="/today" />;
  }

  if (location === '/onboarding') {
    return <Onboarding />;
  }

  return (
    <WorkspaceProvider>
      <Layout>
        <RoutedErrorBoundary>
          <Switch>
            <Route path="/today" component={Today} />
            <Route path="/opportunities" component={Opportunities} />
            <Route path="/companies/:projectCompanyId" component={CompanyIntelligencePage} />
            <Route path="/screening" component={ScreeningPage} />
            <Route path="/companies" component={CompaniesPage} />
            <Route path="/business-twin" component={BusinessTwinPage} />
            <Route path="/plan" component={PlanPage} />
            <Route path="/icp" component={IcpPage} />
            <Route path="/research" component={Research} />
            <Route path="/signals" component={Signals} />
            <Route path="/changes" component={Changes} />
            <Route path="/market-readiness/:campaignId" component={MarketReadinessCampaignPage} />
            <Route path="/market-readiness" component={MarketReadinessPage} />
            <Route path="/outcomes" component={Outcomes} />
            <Route path="/learning" component={Learning} />
            <Route path="/admin/quality" component={AdminQualityPage} />
            <Route path="/admin/access" component={AdminAccessPage} />
            {import.meta.env.DEV && (
              <Route path="/settings/providers" component={ProviderDiagnostics} />
            )}
            <Route path="/settings" component={Settings} />
            <Route>
              <div className="flex h-[50vh] flex-col items-center justify-center text-center">
                <h1 className="font-display text-4xl font-bold text-foreground">404</h1>
                <p className="mt-2 text-muted-foreground">Page not found.</p>
              </div>
            </Route>
          </Switch>
        </RoutedErrorBoundary>
      </Layout>
    </WorkspaceProvider>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AppRoutes() {
  const { isLoaded, isSignedIn } = useAuthSession();

  // The auth implementation renders nothing useful until it has loaded; show a
  // spinner instead of a blank page.
  if (!isLoaded) {
    return <AuthLoading />;
  }

  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />

      <Route>
        {isSignedIn ? <AuthenticatedRoutes /> : <Redirect to="/sign-in" />}
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <AppRoutes />
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}
