/**
 * Shared bits for the fleet reports (4.1–4.4, 5.1, 5.2, 6.1 — rpt-fleet).
 * Tables / sections / loading reuse the finance report building blocks.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/axios";
import type { Delta } from "@/components/admin/reports/framework";

export { RowTable, Section, LoadState, money, istDate, istDateTime, compareLabel } from "../finance/financeShared";

export const FLEET_API = "/admin/dashboard/reports/fleet";

/** GET {FLEET_API}/{path} with the filter params (+ compare=1). Flat JSON response. */
export function useFleetReport<T>(path: string, params: Record<string, string>, extra: Record<string, string | number> = {}) {
  const all = { compare: "1", ...params, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) };
  return useQuery({
    queryKey: ["fleet-report", path, all],
    queryFn: async () => (await apiClient.get<T>(`${FLEET_API}/${path}`, { params: all })).data,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export interface PrevInfo {
  from: string;
  to: string;
  label?: string;
}

export type Deltas<K extends string> = Partial<Record<K, Delta>> | null;

export const days = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })} d`;

export const pctText = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);

export const DOWNTIME_LABELS: Record<string, string> = {
  MAINTENANCE: "Maintenance",
  MANAGER_REPORTED: "Damage review",
  INACTIVE: "Inactive",
  BOOKING_LOCK: "Booking lock",
};

export const VEHICLE_STATUS_LABELS: Record<string, string> = {
  AVAILABLE: "Available",
  OUT_FOR_RENTAL: "Out for rental",
  MAINTENANCE: "Maintenance",
  INACTIVE: "Inactive",
  MANAGER_REPORTED: "Damage review",
};

export const statusLabel = (s: string) => VEHICLE_STATUS_LABELS[s] ?? s;
