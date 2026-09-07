import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { useLocation } from 'wouter';
import { AuthSessionContext, type AuthSession, type AuthUser } from './session';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

/**
 * Resolved lazily (not at module load) so that importing this module in local
 * auth mode never demands a Clerk key.
 */
function resolveClerkConfig(): { publishableKey: string; proxyUrl: string | undefined } {
  const configuredClerkKey: string | undefined = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  // A pk_test_ fallback is returned unconditionally by publishableKeyFromHost and
  // puts every visitor into Clerk "Development mode". Refuse to boot a
  // production bundle with one; provisioning the production Clerk instance
  // (pk_live_ key) is an ops task.
  if (import.meta.env.PROD && configuredClerkKey?.startsWith('pk_test_')) {
    // INTERIM (development-posture deployment): JYRA runs off Replit with a Clerk
    // development instance and NODE_ENV=development on the API, so the whole app is
    // functional end-to-end. A pk_test_ key in a production bundle is intentional here.
    // Before serving real users, provision a production Clerk instance (pk_live_ key).
    console.warn(
      'VITE_CLERK_PUBLISHABLE_KEY is a pk_test_ development key in a production build ' +
        '(intentional for the current development-posture deployment).',
    );
  }
  const publishableKey = publishableKeyFromHost(window.location.hostname, configuredClerkKey);
  if (!publishableKey) {
    throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  }
  return { publishableKey, proxyUrl: import.meta.env.VITE_CLERK_PROXY_URL };
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

export function ClerkSignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

export function ClerkSignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

/**
 * Clears the React Query cache whenever the Clerk user changes so one
 * account never sees another account's cached workspace data.
 */
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

function ClerkSessionBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();

  const signOut = useCallback(async () => {
    await clerk.signOut({ redirectUrl: basePath || '/' });
  }, [clerk]);

  const authUser = useMemo<AuthUser | null>(() => {
    if (!user) return null;
    const email = user.primaryEmailAddress?.emailAddress ?? null;
    return {
      id: user.id,
      displayName: user.fullName || user.firstName || email || 'Signed in',
      email,
      imageUrl: user.imageUrl || null,
    };
  }, [user]);

  const session = useMemo<AuthSession>(
    () => ({
      mode: 'clerk',
      isLoaded: Boolean(isLoaded),
      isSignedIn: Boolean(isLoaded && isSignedIn),
      user: authUser,
      signOut,
      getToken: async () => (isLoaded ? await getToken() : null),
    }),
    [isLoaded, isSignedIn, authUser, signOut, getToken],
  );

  return <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>;
}

/**
 * Must render inside a wouter <Router> (for routerPush/routerReplace) and a
 * <QueryClientProvider> (for the cache invalidator).
 */
export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { publishableKey, proxyUrl } = useMemo(resolveClerkConfig, []);

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      proxyUrl={proxyUrl}
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
      <ClerkQueryClientCacheInvalidator />
      <ClerkSessionBridge>{children}</ClerkSessionBridge>
    </ClerkProvider>
  );
}
