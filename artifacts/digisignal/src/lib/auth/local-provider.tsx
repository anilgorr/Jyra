import { useMemo, type ReactNode } from 'react';
import { toast } from 'sonner';
import { AuthSessionContext, type AuthSession, type AuthUser } from './session';

/**
 * Fixed identity used when VITE_JYRA_AUTH_MODE=local. The API side
 * (JYRA_AUTH_MODE=local) attributes every request to the same stable id, so
 * the `id` here only needs to match for display purposes.
 */
export const LOCAL_USER: AuthUser = {
  id: 'local-dev-user',
  displayName: 'Local developer',
  email: 'local@jyra.dev',
  imageUrl: null,
};

const localSession: AuthSession = {
  mode: 'local',
  isLoaded: true,
  isSignedIn: true,
  user: LOCAL_USER,
  signOut: async () => {
    toast('Local mode has no sign-out', {
      description: 'Switch VITE_JYRA_AUTH_MODE / JYRA_AUTH_MODE to "clerk" to use real accounts.',
    });
  },
  getToken: async () => null,
};

export function LocalAuthProvider({ children }: { children: ReactNode }) {
  const session = useMemo(() => localSession, []);
  return <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>;
}
