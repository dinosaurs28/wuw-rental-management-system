import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { employeeApi } from '../../../lib/api';
import type { OverdueReturnsResponse } from '../../../types/queue';
import { RECOVERY_PAGE_SIZE, RECOVERY_REFETCH_MS, type RecoveryRow } from './recoveryUtils';

type RecoveryPage = OverdueReturnsResponse & { fetchedAt: number };

/**
 * The recovery list (overdue / no-show returns). The key sits under
 * ['employee', 'returns'], so finishing a drop refreshes it too.
 */
export function useRecoveryList(focused: boolean) {
  const q = useInfiniteQuery({
    queryKey: ['employee', 'returns', 'overdue'],
    queryFn: async ({ pageParam }): Promise<RecoveryPage> => {
      const res = await employeeApi.listOverdueReturns({ page: pageParam, limit: RECOVERY_PAGE_SIZE });
      return { ...(res.data as OverdueReturnsResponse), fetchedAt: Date.now() };
    },
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination && last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined,
    refetchInterval: focused ? RECOVERY_REFETCH_MS : false,
    staleTime: 30_000,
    retry: false,
  });

  // Pages can overlap when rows shift between fetches; keep the first copy.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: RecoveryRow[] = [];
    for (const page of q.data?.pages ?? []) {
      for (const row of page.data ?? []) {
        if (seen.has(row.publicId)) continue;
        seen.add(row.publicId);
        out.push({ ...row, fetchedAt: page.fetchedAt });
      }
    }
    return out;
  }, [q.data]);

  return { ...q, rows, head: q.data?.pages[0] };
}

/** Number of OVERDUE + IN_GRACE rentals, for the tab badge and banners. */
export function useRecoveryCount(): number {
  const { data } = useQuery({
    queryKey: ['employee', 'returns', 'overdue-count'],
    queryFn: async () => {
      const res = await employeeApi.listOverdueReturns({ page: 1, limit: 1 });
      return (res.data as OverdueReturnsResponse).overdueCount ?? 0;
    },
    refetchInterval: RECOVERY_REFETCH_MS,
    staleTime: 30_000,
    retry: false,
  });
  return data ?? 0;
}
