import { useGetAdminQualityDashboard } from "@workspace/api-client-react";

export function useAdminAccess() {
  const query = useGetAdminQualityDashboard(
    { days: 1 },
    { query: { queryKey: ["/admin/quality", 1], retry: false, staleTime: 5 * 60 * 1000 } },
  );
  return { isAdmin: query.isSuccess, isChecking: query.isLoading };
}