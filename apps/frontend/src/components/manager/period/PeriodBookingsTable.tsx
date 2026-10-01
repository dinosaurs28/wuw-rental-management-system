import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, ListChecks, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";
import {
  managerPeriodReportService,
  periodBlobErrorMessage,
  periodErrorMessage,
  type PeriodBookingFilters,
  type PeriodBookingsPage,
  type PeriodGroupBy,
} from "@/services/managerPeriodReport.service";
import { formatCount, formatInr, formatIstDateTime } from "./periodRange";

const PAGE_SIZE = 25;

const STATUS_OPTIONS: { value: PeriodBookingFilters["status"]; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PICKED_UP", label: "Picked up" },
  { value: "RETURNED", label: "Returned" },
  { value: "CANCELLED", label: "Cancelled" },
];

const PERIOD_OPTIONS: { value: PeriodBookingFilters["rentalPeriod"]; label: string }[] = [
  { value: "all", label: "All periods" },
  { value: "HOURLY", label: "Hourly" },
  { value: "HALF_DAY", label: "12 hours" },
  { value: "FULL_DAY", label: "1 day" },
  { value: "MULTI_DAY", label: "Multi-day" },
  { value: "MONTHLY", label: "Monthly" },
];

const SOURCE_OPTIONS: { value: PeriodBookingFilters["source"]; label: string }[] = [
  { value: "all", label: "Online + counter" },
  { value: "ONLINE", label: "Online" },
  { value: "COUNTER", label: "Counter" },
];

interface PeriodBookingsTableProps {
  from: string;
  to: string;
  groupBy: PeriodGroupBy;
  /** First page with no filters, already returned by the report call. */
  initial: PeriodBookingsPage;
  /** True while `initial` belongs to a previous range (report refetching). */
  initialStale: boolean;
}

export function PeriodBookingsTable({
  from,
  to,
  groupBy,
  initial,
  initialStale,
}: PeriodBookingsTableProps) {
  const [status, setStatus] = useState<PeriodBookingFilters["status"]>("all");
  const [rentalPeriod, setRentalPeriod] = useState<PeriodBookingFilters["rentalPeriod"]>("all");
  const [source, setSource] = useState<PeriodBookingFilters["source"]>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search.trim(), 400);
  const [downloading, setDownloading] = useState(false);

  // Page resets whenever the range or a filter changes (derived, no effect needed).
  const pageKey = [from, to, status, rentalPeriod, source, debouncedSearch].join("|");
  const [pageState, setPageState] = useState({ key: pageKey, page: 1 });
  const page = pageState.key === pageKey ? pageState.page : 1;
  const setPage = (p: number) => setPageState({ key: pageKey, page: p });

  const filtersActive =
    status !== "all" || rentalPeriod !== "all" || source !== "all" || debouncedSearch !== "";
  const useInitial = page === 1 && !filtersActive;

  const query = {
    from,
    to,
    groupBy,
    page,
    pageSize: PAGE_SIZE,
    status,
    rentalPeriod,
    source,
    search: debouncedSearch || undefined,
  };

  const listQuery = useQuery({
    queryKey: ["bm-period-bookings", from, to, status, rentalPeriod, source, debouncedSearch, page],
    queryFn: () => managerPeriodReportService.getBookings(query),
    enabled: !useInitial,
    placeholderData: keepPreviousData,
  });

  const listError =
    !useInitial && listQuery.isError
      ? periodErrorMessage(listQuery.error, "Could not load bookings. Please try again.")
      : null;

  const data: PeriodBookingsPage | undefined = useInitial ? initial : listQuery.data;
  const loading = useInitial ? false : listQuery.isPending;
  const refreshing = useInitial ? initialStale : listQuery.isFetching;

  const rows = data?.rows ?? [];
  const pagination = data?.pagination;
  const totals = data?.totals;
  const totalPages = pagination?.totalPages ?? 1;
  const firstItem = pagination && pagination.total > 0 ? (page - 1) * pagination.pageSize + 1 : 0;
  const lastItem = pagination ? Math.min(page * pagination.pageSize, pagination.total) : 0;

  const clearFilters = () => {
    setStatus("all");
    setRentalPeriod("all");
    setSource("all");
    setSearch("");
  };

  const download = async () => {
    setDownloading(true);
    const toastId = toast.loading("Preparing bookings CSV…");
    try {
      await managerPeriodReportService.downloadCsv(query, "bookings");
      toast.success("Bookings CSV downloaded", { id: toastId });
    } catch (error) {
      toast.error(await periodBlobErrorMessage(error, "Could not download the CSV."), {
        id: toastId,
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-neutral-100 flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-orange-500" />
            <h2 className="text-base font-semibold text-neutral-900">Bookings in this period</h2>
            {pagination && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 tabular-nums">
                {formatCount(pagination.total)}
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Every booking whose start date falls in the period, newest start first. Totals cover
            all matching bookings, not just this page.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 shrink-0"
          onClick={download}
          disabled={downloading || (pagination?.total ?? 0) === 0}
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Download CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="px-5 py-3 border-b border-neutral-100 flex flex-col lg:flex-row lg:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
          <Input
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search booking ID, customer, phone or reg no"
            className="h-9 pl-9"
            aria-label="Search bookings"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 lg:flex lg:items-center">
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="h-9 w-full lg:w-[150px]" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={rentalPeriod} onValueChange={(v) => setRentalPeriod(v as typeof rentalPeriod)}>
            <SelectTrigger className="h-9 w-full lg:w-[140px]" aria-label="Rental period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
            <SelectTrigger className="h-9 w-full lg:w-[160px]" aria-label="Source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(filtersActive || search) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 gap-1 text-neutral-500"
            onClick={clearFilters}
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {listError ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm font-medium text-red-600">{listError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => listQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <div className={cn("overflow-x-auto transition-opacity", refreshing && "opacity-60")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-400 bg-neutral-50/60">
                <th className="px-5 py-2.5 font-semibold whitespace-nowrap">Booking</th>
                <th className="px-3 py-2.5 font-semibold">Customer</th>
                <th className="px-3 py-2.5 font-semibold">Vehicle</th>
                <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Start (IST)</th>
                <th className="px-3 py-2.5 font-semibold whitespace-nowrap">End (IST)</th>
                <th className="px-3 py-2.5 font-semibold">Period</th>
                <th className="px-3 py-2.5 font-semibold">Source</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold text-right">Total</th>
                <th className="px-3 py-2.5 font-semibold text-right">Paid</th>
                <th className="px-5 py-2.5 font-semibold text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-neutral-100">
                    {Array.from({ length: 11 }).map((__, j) => (
                      <td key={j} className="px-3 py-3 first:pl-5 last:pr-5">
                        <Skeleton className="h-3.5 w-full max-w-[110px]" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-5 py-14 text-center">
                    <ListChecks className="mx-auto h-9 w-9 text-neutral-200" />
                    <p className="mt-2 text-sm font-medium text-neutral-600">
                      {filtersActive
                        ? "No bookings match these filters"
                        : "No bookings start in this period"}
                    </p>
                    {filtersActive && (
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="mt-1 text-xs font-medium text-orange-600 hover:underline"
                      >
                        Clear filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((b) => (
                  <tr key={b.publicId} className="border-t border-neutral-100 align-top hover:bg-neutral-50/60">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <p className="font-mono text-xs font-semibold text-neutral-800">{b.publicId}</p>
                      {b.extensionCount > 0 && (
                        <p className="mt-0.5 text-[11px] text-orange-600">
                          Extended ×{b.extensionCount}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 min-w-[140px]">
                      <p className="font-medium text-neutral-800">{b.customerName}</p>
                      {b.customerPhone && (
                        <p className="text-xs text-neutral-400 tabular-nums">{b.customerPhone}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 min-w-[140px]">
                      <p className="text-neutral-700">{b.vehicle || "—"}</p>
                      {b.regNo && <p className="text-xs text-neutral-400 font-mono">{b.regNo}</p>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs text-neutral-600 tabular-nums">
                      {formatIstDateTime(b.startAt)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs text-neutral-600 tabular-nums">
                      {formatIstDateTime(b.endAt)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="inline-flex rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                        {b.rentalPeriodLabel}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <p className="text-xs font-medium text-neutral-700">{b.sourceLabel}</p>
                      {b.counterStaffName && (
                        <p className="text-[11px] text-neutral-400">by {b.counterStaffName}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums text-neutral-800">
                      {formatInr(b.total)}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums text-neutral-600">
                      {formatInr(b.paid)}
                    </td>
                    <td
                      className={cn(
                        "px-5 py-3 text-right whitespace-nowrap tabular-nums font-medium",
                        b.balance > 0 ? "text-red-600" : "text-neutral-400",
                      )}
                    >
                      {formatInr(b.balance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && totals && totals.bookings > 0 && (
              <tfoot>
                <tr className="border-t border-neutral-200 bg-neutral-50/70 font-semibold text-neutral-800 tabular-nums">
                  <td className="px-5 py-2.5" colSpan={8}>
                    Total · {formatCount(totals.bookings)} booking{totals.bookings === 1 ? "" : "s"}
                    {filtersActive && (
                      <span className="ml-1 text-xs font-normal text-neutral-500">(filtered)</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatInr(totals.total)}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatInr(totals.paid)}</td>
                  <td
                    className={cn(
                      "px-5 py-2.5 text-right whitespace-nowrap",
                      totals.balance > 0 && "text-red-600",
                    )}
                  >
                    {formatInr(totals.balance)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.total > 0 && (
        <div className="px-5 py-3 border-t border-neutral-100 flex items-center justify-between gap-3">
          <span className="text-xs text-neutral-500 tabular-nums">
            {firstItem}–{lastItem} of {formatCount(pagination.total)}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                disabled={page <= 1 || refreshing}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </Button>
              <span className="text-xs text-neutral-500 tabular-nums">
                Page {page} of {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                disabled={page >= totalPages || refreshing}
                onClick={() => setPage(page + 1)}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}
      <p className="px-5 pb-3 text-[11px] text-neutral-400">
        Paid = rental payments received so far (safety deposits excluded). Balance is 0 for
        cancelled bookings.
      </p>
    </div>
  );
}
