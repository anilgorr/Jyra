import { createContext, useContext } from 'react';
import type { AuthMode } from './mode';

export type AuthUser = {
  id: string;
  displayName: string;
  email: string | null;
  imageUrl: string | null;
};

export type AuthSession = {
  mode: AuthMode;
  /** False while the auth implementation is still initialising. */
  isLoaded: boolean;
  isSignedIn: boolean;
  user: AuthUser | null;
  signOut: () => Promise<void>;
  /** Bearer token for the API, or null when the implementation has none. */
  getToken: () => Promise<string | null>;
};

export const AuthSessionContext = createContext<AuthSession | null>(null);

export function useAuthSession(): AuthSession {
  const session = useContext(AuthSessionContext);
  if (!session) {
    throw new Error('useAuthSession must be used inside <AuthProvider>');
  }
  return session;
}
