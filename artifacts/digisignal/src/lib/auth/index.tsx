import type { ReactNode } from 'react';
import { Redirect } from 'wouter';
import { authMode } from './mode';
import { ClerkAuthProvider, ClerkSignInPage, ClerkSignUpPage } from './clerk-provider';
import { LocalAuthProvider } from './local-provider';

export { authMode, isLocalAuthMode, type AuthMode } from './mode';
export { useAuthSession, type AuthSession, type AuthUser } from './session';

/**
 * Selects the auth implementation from VITE_JYRA_AUTH_MODE. Render inside the
 * wouter <Router> and the <QueryClientProvider>; everything below it can call
 * `useAuthSession()`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (authMode === 'local') {
    return <LocalAuthProvider>{children}</LocalAuthProvider>;
  }
  return <ClerkAuthProvider>{children}</ClerkAuthProvider>;
}

function RedirectHome() {
  return <Redirect to="/" replace />;
}

/** Route components for /sign-in and /sign-up; local mode has no sign-in. */
export const SignInPage = authMode === 'local' ? RedirectHome : ClerkSignInPage;
export const SignUpPage = authMode === 'local' ? RedirectHome : ClerkSignUpPage;
