import { useGetCurrentUser } from "@workspace/api-client-react";

/**
 * Whether to show the admin navigation. This used to probe /admin/quality
 * and treat a 403 as "no" - which worked, and also put a red failed request
 * in every customer's console on every page load. /me now says so directly.
 * The server still checks on every admin route; this only decides what is
 * drawn.
 */
export function useAdminAccess() {
  // Same key as App.tsx and Today, so this is one request, not another.
  const query = useGetCurrentUser();
  return { isAdmin: query.data?.isInternalAdmin === true, isChecking: query.isLoading };
}
