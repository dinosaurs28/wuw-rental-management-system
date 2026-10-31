/**
 * Shared bits of the booking / customer / staff reports (3.1–3.5, 7.1, 7.2, 8.1, 8.2 — rpt-bookings).
 * Tables, sections and loading states come from the finance reports' shared module.
 */
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { formatINR, formatNumber, type Delta } from "@/components/admin/reports/framework";

export { LoadState, RowTable, Section, compareLabel, istDate, istDateTime, type Col } from "../finance/financeShared";

export const REPORTS_API = "/admin/dashboard/reports";

export interface PeriodInfo {
  from: string;
  to: string;
  days: number;
  label: string;
  previous: { from: string; to: string; label: string };
}

export interface BookingPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type Deltas = Record<string, Delta> | null;

/** Common booking display fields of every booking-level row. */
export interface BookingBase {
  bookingId: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  branchId: string;
  branchName: string;
  vehicle: string;
  regNo: string;
  category: string;
  source: "APP" | "WALK_IN";
  createdByName: string | null;
}

/** GET /admin/dashboard/reports/{path} with the filter params (+ compare=1, page …). */
export function useBookingReport<T>(
  path: string,
  params: Record<string, string>,
  extra: Record<string, string | number | null | undefined> = {},
  enabled = true,
) {
  const all: Record<string, string> = { ...params, compare: "1" };
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined && v !== "") all[k] = String(v);
  return useQuery({
    queryKey: ["booking-report", path, all],
    queryFn: async () => (await apiClient.get<T>(`${REPORTS_API}/${path}`, { params: all })).data,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  });
}

/** Page number that resets to 1 when `deps` change. */
export function usePageReset(deps: unknown) {
  const [page, setPage] = useState(1);
  const key = JSON.stringify(deps);
  useEffect(() => setPage(1), [key]);
  return [page, setPage] as const;
}

export const moneyOr = (v: number | null | undefined, missing = "Not recorded") =>
  v === null || v === undefined ? missing : formatINR(v);
export const hours = (v: number | null | undefined) => {
  if (v === null || v === undefined) return "—";
  if (v < 48) return `${formatNumber(Math.round(v * 10) / 10)} h`;
  return `${formatNumber(Math.round((v / 24) * 10) / 10)} d`;
};
export const minutesText = (m: number) => {
  if (!m) return "—";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h} h ${mm} min` : `${mm} min`;
};
export const sourceLabel = (s: "APP" | "WALK_IN") => (s === "APP" ? "App" : "Walk-in");

export function BookingPager({ pagination, onPage }: { pagination?: BookingPagination; onPage: (p: number) => void }) {
  if (!pagination) return null;
  if (pagination.totalPages <= 1) return <p className="mt-2 text-xs text-neutral-500">{formatNumber(pagination.total)} rows</p>;
  return (
    <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
      <span>
        {formatNumber(pagination.total)} rows · page {pagination.page} of {pagination.totalPages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="outline" disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/** Small segmented chooser used for row filters. */
export function Chooser<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-white p-1" data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
            value === o.value ? "bg-[#FF5F00] text-white" : "text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Simple horizontal share bars (count + %). */
export function ShareBars({ items }: { items: Array<{ key: string; label: string; count: number; pct: number | null }> }) {
  return (
    <div className="space-y-2 rounded-xl border border-neutral-200 bg-white p-4">
      {items.map((i) => (
        <div key={i.key} className="text-sm">
          <div className="mb-1 flex justify-between text-neutral-700">
            <span>{i.label}</span>
            <span className="tabular-nums text-neutral-500">
              {formatNumber(i.count)} · {i.pct == null ? "–" : `${i.pct}%`}
            </span>
          </div>
          <div className="h-2 rounded-full bg-neutral-100">
            <div className="h-2 rounded-full bg-[#FF5F00]" style={{ width: `${Math.min(100, i.pct ?? 0)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
