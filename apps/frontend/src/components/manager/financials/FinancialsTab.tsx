import { Fragment, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  RotateCcw,
  Search,
  X,
} from "lucide-react";

import apiClient from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ProofPhotoThumb, type ProofPhotoInfo } from "@/components/payment/counter/ProofPhotoThumb";
import { BookingDrawer } from "@/components/manager/customers/BookingDrawer";
import { MANAGER_CUSTOMERS_PORTAL, customersTabKey } from "@/components/manager/customers/portal";
import {
  formatCount,
  formatInr,
  formatIstDateTime,
  formatYmdRange,
  istTodayYmd,
  resolvePreset,
  validateCustomRange,
} from "@/components/manager/period/periodRange";
import { periodBlobErrorMessage } from "@/services/managerPeriodReport.service";
import {
  PAYMENT_MODE_LABELS,
  PAYMENT_TYPE_LABELS,
  PAYMENT_TYPE_ORDER,
  type ClientPaymentType,
  type PaymentModeKey,
} from "@/lib/paymentTypes";
import {
  financialsService,
  type FinancialsQuery,
  type FinancialsRow,
  type FinancialsSort,
  type ShiftStatusFilter,
} from "@/services/financials.service";
import {
  FINANCIALS_PRESETS,
  resetFinancialsFilters,
  type FinancialsPreset,
  type FinancialsViewState,
} from "./financialsState";

const SHIFT_STATUS_LABELS: Record<ShiftStatusFilter, string> = {
  OPEN: "Open shift",
  CLOSED: "Closed shift",
  NONE: "No shift",
};

const ALL = "__all__";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * Branch Manager → Financials → "Financials" sub-tab: every payment collected in the
 * branch, VIEW ONLY (no add / edit / delete here). Cards, table and export share one
 * filter set; the backend splits each payment into the six client types.
 */
export function FinancialsTab({
  state,
  onChange,
  onOpenShift,
}: {
  state: FinancialsViewState;
  onChange: (next: FinancialsViewState) => void;
  /** Opens a shift in the Cash Shift sub-tab (?tab=shift&shift=<id>). */
  onOpenShift: (shiftId: string) => void;
}) {
  const [searchText, setSearchText] = useState(state.search);
  const debouncedSearch = useDebounced(searchText, 300);
  const [openBooking, setOpenBooking] = useState<{ customerId: string; bookingId: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<"csv" | "xlsx" | null>(null);

  // Any filter change goes back to page 1
  const set = (patch: Partial<FinancialsViewState>) =>
    onChange({ ...state, ...patch, page: "page" in patch ? patch.page! : 1 });

  useEffect(() => {
    if (debouncedSearch !== state.search) set({ search: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);
  // A reset from outside (chips / Reset filters) clears the box too
  useEffect(() => {
    if (state.search !== debouncedSearch) setSearchText(state.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.search]);

  const noneSelected = state.types !== null && state.types.length === 0;
  const query: FinancialsQuery = {
    from: state.from,
    to: state.to,
    types: state.types ?? [],
    modes: state.mode ? [state.mode] : [],
    collectedBy: state.collectedBy,
    shiftStatus: state.shiftStatus,
    search: state.search,
    sort: state.sort,
    dir: state.dir,
    page: state.page,
    pageSize: state.pageSize,
  };

  const payments = useQuery({
    queryKey: ["manager", "financials", "payments", query],
    queryFn: () => financialsService.getPayments(query),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const options = useQuery({
    queryKey: ["manager", "financials", "options"],
    queryFn: () => financialsService.getOptions(),
    staleTime: 5 * 60_000,
  });

  const data = payments.data;
  const rows = noneSelected ? [] : (data?.rows ?? []);
  const cards = data?.summary.byType ?? [];
  const countInRange = (t: ClientPaymentType) => cards.find((c) => c.type === t)?.countInRange ?? 0;
  const total = noneSelected ? { amount: 0, count: 0 } : (data?.summary.total ?? { amount: 0, count: 0 });
  const byMode = noneSelected ? { cash: 0, upi: 0, gateway: 0 } : (data?.summary.byMode ?? { cash: 0, upi: 0, gateway: 0 });
  const pagination = data?.pagination;
  const totalPages = noneSelected ? 1 : (pagination?.totalPages ?? 1);
  const collectorName = (id: string) =>
    id === "ONLINE" ? "Online (customer)" : (options.data?.collectors.find((c) => c.id === id)?.name ?? "Fleet member");

  const download = async (format: "csv" | "xlsx") => {
    setDownloading(format);
    const id = toast.loading(`Preparing ${format === "csv" ? "CSV" : "Excel"}…`);
    try {
      await financialsService.download(query, format);
      toast.success("Downloaded", { id });
    } catch (err) {
      toast.error(await periodBlobErrorMessage(err, "Could not export the payments."), { id });
    } finally {
      setDownloading(null);
    }
  };

  const toggleSort = (key: FinancialsSort) => {
    if (state.sort === key) set({ dir: state.dir === "desc" ? "asc" : "desc" });
    else set({ sort: key, dir: "desc" });
  };

  // ── chips ──
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (state.preset !== "today")
    chips.push({
      key: "date",
      label: state.preset === "custom" ? formatYmdRange(state.from, state.to) : FINANCIALS_PRESETS.find((p) => p.value === state.preset)!.label,
      clear: () => set({ preset: "today", ...resolvePreset("today") }),
    });
  if (state.types !== null)
    chips.push({
      key: "types",
      label: state.types.length === 0 ? "No types selected" : state.types.map((t) => PAYMENT_TYPE_LABELS[t]).join(", "),
      clear: () => set({ types: null }),
    });
  if (state.mode) chips.push({ key: "mode", label: PAYMENT_MODE_LABELS[state.mode], clear: () => set({ mode: null }) });
  if (state.collectedBy)
    chips.push({ key: "who", label: collectorName(state.collectedBy), clear: () => set({ collectedBy: null }) });
  if (state.shiftStatus)
    chips.push({ key: "shift", label: SHIFT_STATUS_LABELS[state.shiftStatus], clear: () => set({ shiftStatus: null }) });
  if (state.search) chips.push({ key: "search", label: `“${state.search}”`, clear: () => set({ search: "" }) });

  return (
    <div className="space-y-5">
      {/* ── Filter bar (applies to cards, table and export) ── */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <TypePicker value={state.types} countInRange={countInRange} onChange={(types) => set({ types })} />
          <DateRangePicker
            preset={state.preset}
            from={state.from}
            to={state.to}
            onChange={(p, from, to) => set({ preset: p, from, to })}
          />
          <Select value={state.collectedBy ?? ALL} onValueChange={(v) => set({ collectedBy: v === ALL ? null : v })}>
            <SelectTrigger className="h-9 w-[170px] text-sm" aria-label="Fleet member">
              <SelectValue placeholder="All fleet members" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All fleet members</SelectItem>
              {(options.data?.collectors ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
              <SelectItem value="ONLINE">Online (customer)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={state.mode ?? ALL} onValueChange={(v) => set({ mode: v === ALL ? null : (v as PaymentModeKey) })}>
            <SelectTrigger className="h-9 w-[150px] text-sm" aria-label="Payment mode">
              <SelectValue placeholder="All modes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All modes</SelectItem>
              {(Object.keys(PAYMENT_MODE_LABELS) as PaymentModeKey[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {PAYMENT_MODE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={state.shiftStatus ?? ALL}
            onValueChange={(v) => set({ shiftStatus: v === ALL ? null : (v as ShiftStatusFilter) })}
          >
            <SelectTrigger className="h-9 w-[150px] text-sm" aria-label="Shift status">
              <SelectValue placeholder="Any shift" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any shift</SelectItem>
              {(Object.keys(SHIFT_STATUS_LABELS) as ShiftStatusFilter[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SHIFT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Booking ID, customer, phone, vehicle no."
              className="h-9 pl-8 text-sm"
              maxLength={100}
            />
          </div>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <span
                key={c.key}
                className="inline-flex items-center gap-1 rounded-full bg-orange-50 border border-orange-200 px-2.5 py-0.5 text-xs text-orange-800"
              >
                {c.label}
                <button type="button" onClick={c.clear} aria-label={`Remove ${c.label}`} className="hover:text-orange-950">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => onChange(resetFinancialsFilters(state))}
              className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 ml-1"
            >
              <RotateCcw className="h-3 w-3" /> Reset filters
            </button>
          </div>
        )}
      </div>

      {/* ── Summary cards ── */}
      {payments.isError && !data ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load the payments.{" "}
          <button className="underline" onClick={() => payments.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <div className="col-span-2 rounded-xl border border-neutral-900 bg-neutral-900 p-4 text-white">
            <p className="text-xs text-neutral-300">Total collected</p>
            {payments.isLoading ? (
              <Skeleton className="h-8 w-32 mt-1 bg-neutral-700" />
            ) : (
              <p className="text-2xl font-bold tabular-nums mt-0.5">{formatInr(total.amount)}</p>
            )}
            <p className="text-xs text-neutral-400 mt-1">
              {formatCount(total.count)} payment{total.count === 1 ? "" : "s"} · {formatYmdRange(state.from, state.to)}
            </p>
          </div>
          {PAYMENT_TYPE_ORDER.map((t) => {
            const c = cards.find((x) => x.type === t);
            const off = noneSelected || (state.types !== null && !state.types.includes(t));
            return (
              <div key={t} className={`rounded-xl border bg-white p-3 ${off ? "opacity-50" : ""}`} data-testid={`card-${t}`}>
                <p className="text-xs text-neutral-500">{PAYMENT_TYPE_LABELS[t]}</p>
                {payments.isLoading ? (
                  <Skeleton className="h-6 w-20 mt-1" />
                ) : (
                  <p className="text-lg font-semibold tabular-nums text-neutral-900 mt-0.5">{formatInr(off ? 0 : (c?.amount ?? 0))}</p>
                )}
                <p className="text-[11px] text-neutral-400">{formatCount(off ? 0 : (c?.count ?? 0))} payments</p>
              </div>
            );
          })}
        </div>
      )}
      <ModeSplit byMode={byMode} total={total.amount} />

      {/* ── Table ── */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-neutral-100">
          <div className="text-sm text-neutral-600">
            {payments.isFetching && <Loader2 className="inline h-3.5 w-3.5 animate-spin mr-1.5 text-neutral-400" />}
            {noneSelected ? "Select at least one payment type." : `${formatCount(pagination?.totalRows ?? 0)} payments`}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={!!downloading || noneSelected} onClick={() => download("csv")}>
              {downloading === "csv" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} CSV
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={!!downloading || noneSelected} onClick={() => download("xlsx")}>
              {downloading === "xlsx" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Excel
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50/80 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                <th className="w-8" />
                <SortTh label="Date & time" k="date" state={state} onSort={toggleSort} />
                <SortTh label="Type" k="type" state={state} onSort={toggleSort} />
                <SortTh label="Amount" k="amount" state={state} onSort={toggleSort} right />
                <th className="px-3 py-3 text-left">Mode</th>
                <th className="px-3 py-3 text-left">Booking</th>
                <th className="px-3 py-3 text-left">Customer</th>
                <th className="px-3 py-3 text-left">Vehicle</th>
                <th className="px-3 py-3 text-left">Collected by</th>
                <th className="px-3 py-3 text-left">Cash shift</th>
                <th className="px-3 py-3 text-left">Shift</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {payments.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={11} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-neutral-500">
                    No payments found for these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="hover:bg-neutral-50/60 cursor-pointer" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                      <td className="pl-3">
                        <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${expanded === r.id ? "rotate-180" : ""}`} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-neutral-700">{formatIstDateTime(r.paidAt)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">{r.typeLabel}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap">{formatInr(r.amount)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-neutral-700">{r.mode}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <button
                          type="button"
                          className="font-mono text-xs text-orange-700 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenBooking({ customerId: r.customerId, bookingId: r.bookingId });
                          }}
                        >
                          {r.bookingId}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-neutral-900">{r.customerName}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-neutral-600">{r.vehicle || "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-neutral-700">{r.collectedBy?.name ?? <span className="text-neutral-400">Online (customer)</span>}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {r.shift ? (
                          <button
                            type="button"
                            className="font-mono text-xs text-blue-700 hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenShift(r.shift!.id);
                            }}
                          >
                            {r.shift.id}
                          </button>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {r.shift ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              r.shift.isOpen ? "bg-green-50 text-green-700" : "bg-neutral-100 text-neutral-600"
                            }`}
                          >
                            {r.shift.isOpen ? "Open" : "Closed"}
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                    </tr>
                    {expanded === r.id && (
                      <tr className="bg-neutral-50/70">
                        <td />
                        <td colSpan={10} className="px-3 py-3">
                          <RowDetails row={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
            {rows.length > 0 && data && (
              <tfoot>
                <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-semibold">
                  <td />
                  <td className="px-3 py-3 text-neutral-700" colSpan={2}>
                    Total ({rows.length} shown)
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums" data-testid="page-total">
                    {formatInr(data.pageTotal.amount)}
                  </td>
                  <td className="px-3 py-3 text-xs font-normal text-neutral-500" colSpan={7}>
                    Cash {formatInr(data.pageTotal.cash)} · UPI {formatInr(data.pageTotal.upi)}
                    {data.pageTotal.gateway > 0 ? ` · Online ${formatInr(data.pageTotal.gateway)}` : ""}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {!noneSelected && (pagination?.totalRows ?? 0) > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-neutral-100">
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              Rows per page
              <Select value={String(state.pageSize)} onValueChange={(v) => set({ pageSize: Number(v) })}>
                <SelectTrigger className="h-8 w-[72px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[25, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={state.page <= 1} onClick={() => set({ page: state.page - 1 })}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-neutral-600 px-2">
                Page {state.page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={state.page >= totalPages}
                onClick={() => set({ page: state.page + 1 })}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* The existing BM booking drawer — Refund to customer and Void live there */}
      <BookingDrawer
        service={MANAGER_CUSTOMERS_PORTAL.service}
        queryKey={customersTabKey(MANAGER_CUSTOMERS_PORTAL, "booking")}
        customerId={openBooking?.customerId ?? ""}
        bookingId={openBooking?.bookingId ?? null}
        onClose={() => setOpenBooking(null)}
        canRefundToCustomer={!!MANAGER_CUSTOMERS_PORTAL.canRefundToCustomer}
        onRefunded={() => void payments.refetch()}
      />
    </div>
  );
}

function SortTh({
  label,
  k,
  state,
  onSort,
  right,
}: {
  label: string;
  k: FinancialsSort;
  state: FinancialsViewState;
  onSort: (k: FinancialsSort) => void;
  right?: boolean;
}) {
  const active = state.sort === k;
  const Icon = !active ? ArrowUpDown : state.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <th className={`px-3 py-3 ${right ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide ${active ? "text-neutral-900" : ""}`}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}

function TypePicker({
  value,
  countInRange,
  onChange,
}: {
  value: ClientPaymentType[] | null;
  countInRange: (t: ClientPaymentType) => number;
  onChange: (v: ClientPaymentType[] | null) => void;
}) {
  const selected = value ?? PAYMENT_TYPE_ORDER;
  const label =
    value === null ? "All types" : value.length === 0 ? "No types" : value.length === 1 ? PAYMENT_TYPE_LABELS[value[0]] : `${value.length} types`;
  const toggle = (t: ClientPaymentType) => {
    const next = selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t];
    const ordered = PAYMENT_TYPE_ORDER.filter((x) => next.includes(x));
    onChange(ordered.length === PAYMENT_TYPE_ORDER.length ? null : ordered);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 gap-1.5 text-sm font-normal min-w-[130px] justify-between">
          {label} <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="flex items-center justify-between px-1 pb-2 border-b border-neutral-100 mb-1">
          <button type="button" className="text-xs font-medium text-orange-700 hover:underline" onClick={() => onChange(null)}>
            Select all
          </button>
          <button type="button" className="text-xs font-medium text-neutral-600 hover:underline" onClick={() => onChange([])}>
            Clear
          </button>
        </div>
        {PAYMENT_TYPE_ORDER.map((t) => (
          <label key={t} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-neutral-50 cursor-pointer">
            <Checkbox checked={selected.includes(t)} onCheckedChange={() => toggle(t)} />
            <span className="flex-1">{PAYMENT_TYPE_LABELS[t]}</span>
            <span className="text-xs tabular-nums text-neutral-400">({countInRange(t)})</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function DateRangePicker({
  preset,
  from,
  to,
  onChange,
}: {
  preset: FinancialsPreset;
  from: string;
  to: string;
  onChange: (preset: FinancialsPreset, from: string, to: string) => void;
}) {
  const today = istTodayYmd();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  useEffect(() => {
    setDraftFrom(from);
    setDraftTo(to);
  }, [from, to]);

  const apply = (f: string, t: string) => {
    if (validateCustomRange(f, t) || t > today) return;
    onChange("custom", f, t);
  };
  const error = preset === "custom" || draftFrom !== from || draftTo !== to ? validateCustomRange(draftFrom, draftTo) : null;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select
        value={preset}
        onValueChange={(v) => {
          const p = v as FinancialsPreset;
          if (p === "custom") onChange("custom", from, to);
          else {
            const r = resolvePreset(p);
            onChange(p, r.from, r.to);
          }
        }}
      >
        <SelectTrigger className="h-9 w-[140px] text-sm" aria-label="Date range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FINANCIALS_PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex flex-col text-[11px] text-neutral-500">
        From
        <Input
          type="date"
          value={draftFrom}
          max={draftTo && draftTo < today ? draftTo : today}
          onChange={(e) => {
            setDraftFrom(e.target.value);
            apply(e.target.value, draftTo);
          }}
          className="h-9 w-[150px] text-sm"
        />
      </label>
      <label className="flex flex-col text-[11px] text-neutral-500">
        To
        <Input
          type="date"
          value={draftTo}
          min={draftFrom}
          max={today}
          onChange={(e) => {
            setDraftTo(e.target.value);
            apply(draftFrom, e.target.value);
          }}
          className="h-9 w-[150px] text-sm"
        />
      </label>
      {error && <span className="text-xs text-red-600 pb-2">{error}</span>}
    </div>
  );
}

function ModeSplit({ byMode, total }: { byMode: { cash: number; upi: number; gateway: number }; total: number }) {
  const parts = useMemo(
    () => [
      { key: "cash", label: "Cash", amount: byMode.cash, color: "bg-emerald-500" },
      { key: "upi", label: "UPI", amount: byMode.upi, color: "bg-blue-500" },
      { key: "gateway", label: "Online (gateway)", amount: byMode.gateway, color: "bg-violet-500" },
    ],
    [byMode],
  );
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4" data-testid="mode-split">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-neutral-500">Split by payment mode</p>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-100">
        {total > 0 &&
          parts.map((p) => (p.amount > 0 ? <div key={p.key} className={p.color} style={{ width: `${(p.amount / total) * 100}%` }} /> : null))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${p.color}`} />
            <span className="text-neutral-500">{p.label}</span>
            <span className="font-semibold tabular-nums text-neutral-900">{formatInr(p.amount)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const PURPOSE_LABELS: Record<string, string> = {
  ADVANCE: "Advance",
  FULL_PAYMENT: "Full payment",
  REMAINING_BALANCE: "Balance / drop charges",
  EXTENSION: "Extension",
  DAMAGE_FEE: "Damage fee",
  SAFETY_DEPOSIT: "Safety deposit",
};

function RowDetails({ row }: { row: FinancialsRow }) {
  // The payment-screen photo(s) come from the existing transaction read (15-minute URL)
  const proof = useQuery({
    queryKey: ["manager", "financials", "txn", row.transactionId],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { proofPhoto?: ProofPhotoInfo | null; proofs?: ProofPhotoInfo[] } }>(
        `/branchManager/payment/transactions/${encodeURIComponent(row.transactionId)}`,
      );
      return res.data.data;
    },
    enabled: row.hasProof,
    staleTime: 10 * 60_000,
  });
  const items: [string, string][] = [
    ["Transaction", row.transactionId],
    ["Recorded as", PURPOSE_LABELS[row.purpose] ?? row.purpose],
    ["Status", row.status === "COLLECTED" ? "Awaiting confirmation" : "Confirmed"],
    ["Payment mode", row.mode],
    ...(row.transactionCash > 0 && row.transactionOnline > 0
      ? ([["Cash / online", `${formatInr(row.transactionCash)} cash + ${formatInr(row.transactionOnline)} online`]] as [string, string][])
      : []),
    ...(row.partCount > 1
      ? ([["Part of", `${formatInr(row.transactionTotal)} payment split over ${row.partCount} types`]] as [string, string][])
      : []),
    ["This part", `${formatInr(row.amount)}${row.cash > 0 && row.amount !== row.cash ? ` (cash ${formatInr(row.cash)})` : ""}`],
    ["Reference (UPI / card)", row.reference || "—"],
    ...(row.onlineGateway ? ([["Gateway", row.onlineGateway]] as [string, string][]) : []),
    ["Customer phone", row.customerPhone || "—"],
    ["Vehicle", row.vehicleName ? `${row.vehicleName} (${row.vehicle})` : row.vehicle || "—"],
    ["Notes", row.notes || "—"],
  ];
  return (
    <div className="flex flex-wrap gap-6">
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs min-w-[280px]">
        {items.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-neutral-500">{k}</dt>
            <dd className="text-neutral-800 break-all">{v}</dd>
          </Fragment>
        ))}
      </dl>
      {row.hasProof && (
        <div>
          <p className="text-xs text-neutral-500 mb-1">Receipt photo</p>
          {proof.isLoading ? (
            <Skeleton className="h-16 w-12" />
          ) : proof.data?.proofPhoto ? (
            <ProofPhotoThumb
              photo={proof.data.proofPhoto}
              photos={proof.data.proofs}
              size="md"
              caption={`${row.customerName} · ${row.bookingId} · ${formatInr(row.transactionTotal)}`}
            />
          ) : (
            <span className="text-xs text-neutral-400">Not available</span>
          )}
        </div>
      )}
    </div>
  );
}
