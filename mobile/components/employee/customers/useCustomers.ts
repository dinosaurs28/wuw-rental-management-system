import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query';
import { employeeCustomersApi } from '../../../lib/api';
import type { CustomerFilter, CustomerRow } from '../../../types/customers';

export const CUSTOMERS_PAGE_SIZE = 20;

/** Every Customers-tab query sits under this key. */
export const CUSTOMERS_KEY = ['employee', 'customers'] as const;

/** `value`, once it has stopped changing for `ms`. */
export function useDebouncedValue<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** The customer list, newest first, one page per scroll. */
export function useCustomerList(search: string, filter: CustomerFilter) {
  const q = useInfiniteQuery({
    queryKey: [...CUSTOMERS_KEY, 'list', search, filter],
    queryFn: async ({ pageParam }) =>
      (
        await employeeCustomersApi.list({
          search: search || undefined,
          filter,
          page: pageParam,
          limit: CUSTOMERS_PAGE_SIZE,
        })
      ).data,
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    // A new search / filter keeps the old rows on screen (dimmed) until it lands.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });

  // A customer registering between pages shifts the list by one; keep the first copy.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: CustomerRow[] = [];
    for (const page of q.data?.pages ?? []) {
      for (const row of page.data ?? []) {
        if (seen.has(row.customerPublicId)) continue;
        seen.add(row.customerPublicId);
        out.push(row);
      }
    }
    return out;
  }, [q.data]);

  return { ...q, rows, total: q.data?.pages[0]?.total ?? 0 };
}

export function useCustomerDetail(customerId: string | undefined) {
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, 'detail', customerId],
    queryFn: async () => (await employeeCustomersApi.get(customerId as string)).data.data,
    enabled: !!customerId,
    staleTime: 30_000,
    retry: false,
  });
}

export function useCustomerBooking(customerId: string | undefined, bookingId: string | undefined) {
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, 'booking', customerId, bookingId],
    queryFn: async () =>
      (await employeeCustomersApi.booking(customerId as string, bookingId as string)).data.data,
    enabled: !!customerId && !!bookingId,
    staleTime: 0,
    retry: false,
  });
}

/**
 * After a blacklist change: this tab's lists and detail, plus the walk-in
 * customer search / detail screens, which show the blacklist too.
 */
export function refreshAfterBlacklist(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY });
  void queryClient.invalidateQueries({ queryKey: ['employee', 'customer-search'] });
  void queryClient.invalidateQueries({ queryKey: ['employee', 'customer'] });
}
