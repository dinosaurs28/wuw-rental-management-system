import { useQuery } from "@tanstack/react-query";
import { fetchBranchSchedule, type BranchScheduleConfig } from "@/services/branch.service";

export function useBranchSchedule(branchPublicId: string | undefined) {
  const query = useQuery({
    queryKey: ["branch-schedule", branchPublicId],
    queryFn: () => fetchBranchSchedule(branchPublicId!),
    enabled: !!branchPublicId,
    staleTime: 5 * 60 * 1000,
    retry: false,
    throwOnError: false,
  });

  return {
    schedule: query.data as BranchScheduleConfig | undefined,
    isLoading: query.isLoading,
  };
}
