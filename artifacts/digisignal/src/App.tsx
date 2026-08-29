import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Route, Switch, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { Loader2 } from 'lucide-react';
import { useGetCurrentUser } from '@workspace/api-client-react';

import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient } from '@/lib/queryClient';

import { Layout } from './components/layout/layout';
import Landing from './pages/landing';
import Today from './pages/today';
import Onboarding from './pages/onboarding';
import Settings from './pages/settings';
import EmptyFeature from './pages/empty-feature';
import BusinessTwinPage from './pages/business-twin';
import IcpPage from './pages/icp';
import CompaniesPage from './pages/companies/index';
import ProviderDiagnostics from './pages/provider-diagnostics';
import { WorkspaceProvider } from './context/workspace-context';

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(8, 83%, 65%)', // Coral accent
    colorForeground: 'hsl(40, 10%, 14%)', // Deep ink
    colorMutedForeground: 'hsl(35, 9%, 40%)',
    colorDanger: 'hsl(0, 84%, 60%)',
    colorBackground: 'hsl(42, 40%, 98%)', // Card bg
    colorInput: 'hsl(35, 18%, 78%)',
    colorInputForeground: 'hsl(40, 10%, 14%)',
    colorNeutral: 'hsl(35, 20%, 85%)',
    fontFamily: '"DM Sans", sans-serif',
    borderRadius: '0.375rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-card border border-border shadow-sm rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'font-display text-foreground',
    headerSubtitle: 'text-muted-foreground',
    socialButtonsBlockButtonText: 'text-foreground font-medium',
    formFieldLabel: 'text-foreground font-medium',
    footerActionLink: 'text-primary font-medium hover:text-accent',
    footerActionText: 'text-muted-foreground',
    dividerText: 'text-muted-foreground',
    identityPreviewEditButton: 'text-primary',
    formFieldSuccessText: 'text-primary',
    alertText: 'text-foreground',
    logoBox: 'h-10 mb-4',
    logoImage: 'h-full object-contain',
    socialButtonsBlockButton: 'border border-border bg-background hover:bg-muted transition-colors',
    formButtonPrimary: 'bg-accent hover:bg-accent/90 text-accent-foreground shadow-sm transition-all',
    formFieldInput: 'bg-background border border-border focus:border-ring focus:ring-1 focus:ring-ring text-foreground',
    footerAction: 'justify-center',
    dividerLine: 'bg-border',
    alert: 'bg-destructive/10 border-destructive text-destructive',
    otpCodeFieldInput: 'bg-background border border-border focus:border-ring text-foreground',
    formFieldRow: 'mb-4',
    main: 'flex flex-col gap-4',
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/today" />
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
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
            <Route path="/opportunities">
              <EmptyFeature title="Opportunity Intelligence" description="Opportunity qualification is planned for a later milestone. No buying intent or recommendations have been generated." />
            </Route>
            <Route path="/companies" component={CompaniesPage} />
            <Route path="/business-twin" component={BusinessTwinPage} />
            <Route path="/icp" component={IcpPage} />
            <Route path="/research">
              <EmptyFeature title="Research" description="No research providers or jobs are connected. JYRA has not gathered evidence." />
            </Route>
            <Route path="/outcomes">
              <EmptyFeature title="Outcomes" description="Outcome capture is planned for a later milestone. No sales outcomes have been recorded." />
            </Route>
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

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      
      <Route>
        <Show when="signed-in">
          <AuthenticatedRoutes />
        </Show>
        <Show when="signed-out">
          <Redirect to="/sign-in" />
        </Show>
      </Route>
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: 'Welcome back',
            subtitle: 'Sign in to continue to JYRA',
          },
        },
        signUp: {
          start: {
            title: 'Create your account',
            subtitle: 'Set up your first JYRA workspace',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <AppRoutes />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}
