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
import CompanyIntelligencePage from './pages/company-intelligence';
import ProviderDiagnostics from './pages/provider-diagnostics';
import Research from './pages/research';
import Signals from './pages/signals';
import MarketReadinessPage from './pages/market-readiness/index';
import MarketReadinessCampaignPage from './pages/market-readiness/campaign';
import Opportunities from './pages/opportunities';
import Outcomes from './pages/outcomes';
import Learning from './pages/learning';
import AdminQualityPage from './pages/admin-quality';
import { WorkspaceProvider } from './context/workspace-context';

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

function AuthenticatedRoutes() {
  const [location] = useLocation();
  const { data: user, isLoading, isError } = useGetCurrentUser();

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
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
            <Route path="/companies" component={CompaniesPage} />
            <Route path="/business-twin" component={BusinessTwinPage} />
            <Route path="/icp" component={IcpPage} />
            <Route path="/research" component={Research} />
            <Route path="/signals" component={Signals} />
            <Route path="/market-readiness/:campaignId" component={MarketReadinessCampaignPage} />
            <Route path="/market-readiness" component={MarketReadinessPage} />
            <Route path="/outcomes" component={Outcomes} />
            <Route path="/learning" component={Learning} />
            <Route path="/admin/quality" component={AdminQualityPage} />
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
