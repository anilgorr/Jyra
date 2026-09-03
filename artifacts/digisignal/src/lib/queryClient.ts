import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

type ErrorLike = { status?: number; message?: string; data?: unknown };

/** Human-readable message for a failed request, preferring the API's own text. */
export function describeError(error: unknown, fallback = 'Something went wrong'): string {
  const err = (error ?? {}) as ErrorLike;
  const data = err.data as { error?: string; message?: string } | null | undefined;
  if (data && typeof data === 'object') {
    if (typeof data.error === 'string' && data.error) return data.error;
    if (typeof data.message === 'string' && data.message) return data.message;
  }
  if (typeof err.message === 'string' && err.message) return err.message;
  return fallback;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as ErrorLike | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Errors that are part of normal flow and must not toast:
 * - 404 on optional resources (e.g. "no assessment yet")
 * - 401 while Clerk is still exchanging the session
 */
function isExpectedError(error: unknown): boolean {
  const status = statusOf(error);
  return status === 404 || status === 401;
}

// De-duplicate identical toasts fired by several observers of one query.
const recentToasts = new Map<string, number>();
const TOAST_DEDUPE_MS = 4000;

function surfaceError(title: string, error: unknown) {
  if (isExpectedError(error)) return;
  const description = describeError(error);
  const key = `${title}|${description}`;
  const now = Date.now();
  const last = recentToasts.get(key);
  if (last && now - last < TOAST_DEDUPE_MS) return;
  recentToasts.set(key, now);
  toast.error(title, { description });
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Queries opt out with `meta: { silent: true }` when the page renders
      // its own error state and a toast would be redundant.
      if (query.meta?.silent) return;
      const title =
        typeof query.meta?.errorTitle === 'string'
          ? query.meta.errorTitle
          : 'Could not load data';
      surfaceError(title, error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.silent) return;
      // Mutations with their own onError already surface the failure.
      if (mutation.options.onError) return;
      const title =
        typeof mutation.meta?.errorTitle === 'string'
          ? mutation.meta.errorTitle
          : 'Action failed';
      surfaceError(title, error);
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: { silent?: boolean; errorTitle?: string };
    mutationMeta: { silent?: boolean; errorTitle?: string };
  }
}
