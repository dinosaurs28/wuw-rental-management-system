import { useQuery } from '@tanstack/react-query';
import { vehiclesApi } from '../lib/api';
import { toScheduleConfig, type BranchScheduleConfig } from '../lib/branchSchedule';

// A branch's office hours (#2) from the public schedule endpoint. `data` is
// undefined while loading, without a branch, or when the call fails — booking
// screens then offer every time and the server stays the judge.
export function useBranchSchedule(branchPublicId?: string | null) {
  return useQuery<BranchScheduleConfig | null>({
    queryKey: ['branch-schedule', branchPublicId ?? null],
    queryFn: async () => toScheduleConfig((await vehiclesApi.branchSchedule(branchPublicId!)).data),
    enabled: !!branchPublicId,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
