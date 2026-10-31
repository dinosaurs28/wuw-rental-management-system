/**
 * Small building blocks shared by the finance reports (2.1–2.5, rpt-finance):
 * data loading against the shared filter params, a plain row table with
 * "Not recorded" for missing values, and a pager.
 */
import { useEffect, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import apiClient from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR, formatNumber } from "@/components/admin/reports/framework";

export const FINANCE_API = "/admin/dashboard/reports/finance";

export interface Pagination {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

/** GET {FINANCE_API}/{path} with the filter params; `{ data }` envelope unwrapped. */
export function useFinanceReport<T>(path: string, params: Record<string, string>, extra: Record<string, string | number> = {}) {
  const all = { ...params, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) };
  return useQuery({
    queryKey: ["finance-report", path, all],
    queryFn: async () => (await apiClient.get<{ data: T }>(`${FINANCE_API}/${path}`, { params: all })).data.data,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Resets the page to 1 whenever the filters change. */
export function usePage(deps: unknown) {
  const [page, setPage] = useState(1);
  const key = JSON.stringify(deps);
  useEffect(() => setPage(1), [key]);
  return [page, setPage] as const;
}

export const money = (v: number | null | undefined) => (v === null || v === undefined ? "Not recorded" : formatINR(v));
export const istDateTime = (v: string | Date | null | undefined) =>
  v
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(v))
    : "—";
export const istDate = (v: string | Date | null | undefined) =>
  v
    ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(new Date(v))
    : "—";

export interface Col<R> {
  header: string;
  cell: (r: R) => ReactNode;
  align?: "right" | "left";
  className?: string;
}

export function RowTable<R>({
  columns,
  rows,
  empty = "No rows for these filters.",
  rowKey,
  testId,
}: {
  columns: Col<R>[];
  rows: R[] | undefined;
  empty?: string;
  rowKey: (r: R, i: number) => string;
  testId?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white" data-testid={testId}>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.header} className={c.align === "right" ? "text-right whitespace-nowrap" : "whitespace-nowrap"}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {!rows || rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-neutral-500">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r, i) => (
              <TableRow key={rowKey(r, i)}>
                {columns.map((c) => (
                  <TableCell
                    key={c.header}
                    className={`${c.align === "right" ? "text-right tabular-nums" : ""} whitespace-nowrap text-sm ${c.className ?? ""}`}
                  >
                    {c.cell(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function Pager({ pagination, onPage }: { pagination?: Pagination; onPage: (p: number) => void }) {
  if (!pagination || pagination.totalPages <= 1) {
    return pagination ? <p className="mt-2 text-xs text-neutral-500">{formatNumber(pagination.totalRows)} rows</p> : null;
  }
  return (
    <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
      <span>
        {formatNumber(pagination.totalRows)} rows · page {pagination.page} of {pagination.totalPages}
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

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function LoadState({ isLoading, error }: { isLoading: boolean; error: unknown }) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (error) {
    const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Could not load the report.";
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{msg}</div>;
  }
  return null;
}

export const compareLabel = (prev?: { from: string; to: string; label?: string } | null) =>
  prev ? `vs ${prev.label ?? `${prev.from} – ${prev.to}`}` : undefined;
