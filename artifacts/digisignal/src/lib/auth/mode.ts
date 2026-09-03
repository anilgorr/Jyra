/**
 * Which authentication implementation the web app runs with.
 *
 * - `clerk` (default): Clerk hosts sign-in/sign-up and the session; the API
 *   verifies the Clerk session cookie.
 * - `local`: no sign-in at all. The app renders as a fixed local developer and
 *   the API (started with `JYRA_AUTH_MODE=local`) attributes every request to
 *   the same fixed identity. Development only: a production bundle refuses it
 *   both at build time (vite.config.ts) and here at runtime.
 */
export type AuthMode = 'clerk' | 'local';

export const AUTH_MODE_ENV = 'VITE_JYRA_AUTH_MODE';

export function parseAuthMode(raw: unknown): AuthMode {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === '' || value === 'clerk') return 'clerk';
  if (value === 'local') return 'local';
  throw new Error(
    `${AUTH_MODE_ENV}="${String(raw)}" is not a valid auth mode. Use "clerk" (default) or "local" (development only).`,
  );
}

export const authMode: AuthMode = parseAuthMode(import.meta.env.VITE_JYRA_AUTH_MODE);

if (import.meta.env.PROD && authMode === 'local') {
  throw new Error(
    `${AUTH_MODE_ENV}=local is forbidden in a production build: local auth mode has no sign-in and ` +
      'must never be served to real users. Unset it (or set "clerk") and build again.',
  );
}

export const isLocalAuthMode = authMode === 'local';
