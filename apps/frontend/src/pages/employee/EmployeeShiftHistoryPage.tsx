import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, History, Info, RefreshCw } from "lucide-react";

import { DashboardNavbar } from "@/components/employee/DashboardNavbar";
import { refreshActiveShift, useActiveShift } from "@/components/employee/counter/useActiveShift";
import { ShiftStatusBadge } from "@/components/manager/payment/PaymentStateBadge";
import { ShiftDetailSheet, ShiftMoneyBreakdown } from "@/components/manager/payment/ShiftDetailSheet";
import { TotalsStrip, VarianceValue } from "@/components/manager/payment/ShiftTotals";
import {
  LEGACY_VARIANCE_NOTE,
  addIstDays,
  formatIstDateTime,
  formatIstDay,
  formatIstTime,
  formatMoney,
  istToday,
  toPaise,
} from "@/components/manager/payment/cashShiftFormat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/counterErrors";
import {
  employeePaymentService,
  type ShiftDayTotals,
  type ShiftListFilters,
  type ShiftView,
} from "@/services/payment.service";

type Preset = "today" | "yesterday" | "last7" | "last30" | "custom";
type StatusChip = "ALL" | "OPEN" | "ENDED" | "DISCREPANCY_FLAGGED";

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "custom", label: "Custom" },
];

const STATUS_CHIPS: Array<{ value: StatusChip; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "ENDED", label: "Closed" },
  { value: "DISCREPANCY_FLAGGED", label: "Flagged" },
];

/** IST calendar range for a preset (inclusive). */
function presetRange(preset: Exclude<Preset, "custom">, today: string): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addIstDays(today, -1);
      return { from: y, to: y };
    }
    case "last7":
      return { from: addIstDays(today, -6), to: today };
    case "last30":
      return { from: addIstDays(today, -29), to: today };
  }
}

const loadMyShift = (publicId: string) => employeePaymentService.getMyShift(publicId);

function chipClass(active: boolean) {
  return `h-8 rounded-full border px-3.5 text-xs font-medium transition-colors ${
    active
      ? "border-neutral-900 bg-neutral-900 text-white"
      : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
  }`;
}

export default function EmployeeShiftHistoryPage() {
  const today = istToday();
  const { activeShift } = useActiveShift();

  const [preset, setPreset] = useState<Preset>("last7");
  const [customFrom, setCustomFrom] = useState(() => addIstDays(today, -6));
  const [customTo, setCustomTo] = useState(today);
  const [statusChip, setStatusChip] = useState<StatusChip>("ALL");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [shifts, setShifts] = useState<ShiftView[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ShiftDayTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // Live figures for the current-shift card (the store may be from an earlier page).
  useEffect(() => {
    void refreshActiveShift();
  }, []);

  const range = preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset, today);
  const rangeFrom = range.from;
  const rangeTo = range.to;
  const rangeError =
    rangeFrom && rangeTo && rangeFrom > rangeTo ? "The from date must be on or before the to date." : null;

  const load = useCallback(async () => {
    if (rangeError) return;
    const filters: Omit<ShiftListFilters, "employeePublicId"> = {};
    if (statusChip !== "ALL") filters.status = statusChip;
    if (rangeFrom) filters.from = rangeFrom;
    if (rangeTo) filters.to = rangeTo;

    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await employeePaymentService.getMyShifts(page, pageSize, filters);
      if (seq !== requestSeq.current) return;
      setShifts(res.data);
      setTotal(res.total);
      setSummary(res.summary);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setShifts([]);
      setTotal(0);
      setSummary(null);
      setLoadError(apiErrorMessage(err, "Couldn't load your shifts."));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [page, statusChip, rangeFrom, rangeTo, rangeError]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshAll = () => {
    void refreshActiveShift();
    load();
  };

  const totalPages = Math.ceil(total / pageSize);
  const rangeLabel =
    range.from && range.to
      ? range.from === range.to
        ? formatIstDay(range.from)
        : `${formatIstDay(range.from)} – ${formatIstDay(range.to)}`
      : range.from
        ? `From ${formatIstDay(range.from)}`
        : range.to
          ? `Up to ${formatIstDay(range.to)}`
          : "All dates";

  return (
    <div className="min-h-screen bg-gray-50/50 pb-20">
      <DashboardNavbar />

      <main className="container max-w-[1600px] mx-auto py-6 px-4 md:px-6 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-2xl md:text-3xl font-bold tracking-tight text-foreground">
              <History className="h-6 w-6 text-orange-500" /> My shifts
            </h1>
            <p className="text-sm text-muted-foreground">
              Your cash shifts across every branch. Expected in drawer = opening cash + cash collected − cash refunded.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading} className="h-9 gap-1.5 text-xs self-start sm:self-auto">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {/* Current open shift */}
        {activeShift && (
          <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 md:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-blue-900">
                  <span className="h-2 w-2 rounded-full bg-blue-500" /> Current shift
                </p>
                <p className="mt-0.5 text-xs text-blue-800/80">
                  Opened {formatIstDateTime(activeShift.openedAt, true)}
                  {activeShift.branchName ? ` · ${activeShift.branchName}` : ""} · figures are live
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs border-blue-200 text-blue-800 hover:bg-blue-100"
                onClick={() => setDetailId(activeShift.publicId)}
              >
                View transactions
              </Button>
            </div>
            <div className="max-w-xl">
              <ShiftMoneyBreakdown shift={{ ...activeShift, isOpen: true }} hideClosing />
            </div>
          </section>
        )}

        {/* Filters */}
        <section className="rounded-xl border border-neutral-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              <CalendarDays className="h-3 w-3" /> Dates (IST)
            </span>
            {PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={chipClass(preset === p.value)}
                onClick={() => {
                  if (p.value === "custom" && preset !== "custom") {
                    // Start the custom range from what is on screen.
                    setCustomFrom(range.from);
                    setCustomTo(range.to);
                  }
                  setPreset(p.value);
                  setPage(1);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {preset === "custom" && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">From</span>
                <Input
                  type="date"
                  value={customFrom}
                  max={customTo || today}
                  onChange={(e) => { setCustomFrom(e.target.value); setPage(1); }}
                  className="h-9 w-40 text-sm"
                />
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">To</span>
                <Input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  max={today}
                  onChange={(e) => { setCustomTo(e.target.value); setPage(1); }}
                  className="h-9 w-40 text-sm"
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Status</span>
            {STATUS_CHIPS.map((chip) => (
              <button
                key={chip.value}
                type="button"
                className={chipClass(statusChip === chip.value)}
                onClick={() => { setStatusChip(chip.value); setPage(1); }}
              >
                {chip.label}
              </button>
            ))}
          </div>
          {rangeError && <p className="text-xs text-red-600">{rangeError}</p>}
        </section>

        {summary && summary.shiftCount > 0 && !loadError && (
          <section className="space-y-2">
            <p className="text-xs font-medium text-neutral-500">
              Totals · <span className="text-neutral-800">{rangeLabel}</span>
            </p>
            <TotalsStrip totals={summary} />
          </section>
        )}

        {/* Shift list */}
        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {loading ? (
            <div className="divide-y divide-neutral-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-3.5 w-28 animate-pulse rounded bg-neutral-100" />
                  <div className="h-3.5 flex-1 animate-pulse rounded bg-neutral-100" />
                  <div className="h-3.5 w-20 animate-pulse rounded bg-neutral-100" />
                  <div className="h-6 w-20 animate-pulse rounded-full bg-neutral-100" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <AlertTriangle className="h-6 w-6 text-red-400" />
              <p className="text-sm text-neutral-700">{loadError}</p>
              <Button variant="outline" size="sm" onClick={load} className="gap-1.5 text-xs">
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </Button>
            </div>
          ) : shifts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
                <History className="h-6 w-6 text-neutral-400" />
              </div>
              <p className="font-medium text-neutral-700">No shifts for these filters</p>
              <p className="mt-1 text-sm text-neutral-400">Nothing opened on {rangeLabel}.</p>
            </div>
          ) : (
            <>
              {/* Phone: cards */}
              <ul className="divide-y divide-neutral-100 md:hidden">
                {shifts.map((s) => (
                  <li key={s.publicId}>
                    <button
                      type="button"
                      onClick={() => setDetailId(s.publicId)}
                      className={`w-full px-4 py-3.5 text-left hover:bg-neutral-50 ${
                        s.status === "DISCREPANCY_FLAGGED" ? "border-l-4 border-l-red-400" : s.isOpen ? "border-l-4 border-l-blue-300" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-neutral-900">{formatIstDay(s.istDate)}</p>
                          <p className="text-[11px] text-neutral-500">
                            {formatIstTime(s.openedAt)} – {s.closedAt ? formatIstTime(s.closedAt) : "open"}
                            {s.branchName ? ` · ${s.branchName}` : ""}
                          </p>
                        </div>
                        <ShiftStatusBadge status={s.status} />
                      </div>
                      <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-neutral-500">Expected</p>
                          <p className="font-semibold tabular-nums text-neutral-900">{formatMoney(s.expectedClosing)}</p>
                        </div>
                        <div>
                          <p className="text-neutral-500">Counted</p>
                          <p className="font-semibold tabular-nums text-neutral-900">{formatMoney(s.closingCash)}</p>
                        </div>
                        <div>
                          <p className="text-neutral-500">Variance</p>
                          <VarianceValue value={s.variance} />
                        </div>
                      </div>
                      <p className="mt-1.5 text-[11px] text-neutral-500">
                        Opening {formatMoney(s.openingCash)} · Collected {formatMoney(s.cashCollected)}
                        {toPaise(s.cashRefunded) > 0 ? ` · Refunded ${formatMoney(s.cashRefunded)}` : ""}
                        {toPaise(s.upiCollected) > 0 ? ` · UPI ${formatMoney(s.upiCollected)}` : ""}
                      </p>
                      {s.reconciledAt && (
                        <p className="mt-1 text-[11px] text-green-700">
                          Reconciled{s.reconciledByName ? ` by ${s.reconciledByName}` : ""}
                        </p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>

              {/* Tablet / desktop: table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[1100px]">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50/80">
                      {[
                        ["Opened", "left"],
                        ["Closed", "left"],
                        ["Branch", "left"],
                        ["Opening cash", "right"],
                        ["Cash collected", "right"],
                        ["UPI collected", "right"],
                        ["Refunds", "right"],
                        ["Expected", "right"],
                        ["Counted", "right"],
                        ["Variance", "right"],
                        ["Status", "left"],
                      ].map(([h, align]) => (
                        <th
                          key={h}
                          className={`whitespace-nowrap px-3 py-3.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 ${align === "right" ? "text-right" : "text-left"}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {shifts.map((s) => {
                      const pending = toPaise(s.pendingCash);
                      return (
                        <tr
                          key={s.publicId}
                          tabIndex={0}
                          onClick={() => setDetailId(s.publicId)}
                          onKeyDown={(e) => { if (e.key === "Enter") setDetailId(s.publicId); }}
                          className={`cursor-pointer transition-colors hover:bg-neutral-50/60 ${
                            s.status === "DISCREPANCY_FLAGGED" ? "border-l-4 border-l-red-400" : s.isOpen ? "border-l-4 border-l-blue-300" : ""
                          }`}
                        >
                          <td className="whitespace-nowrap px-3 py-3.5 text-xs text-neutral-700">{formatIstDateTime(s.openedAt, true)}</td>
                          <td className="whitespace-nowrap px-3 py-3.5 text-xs text-neutral-500">
                            {s.closedAt ? formatIstDateTime(s.closedAt) : <span className="text-neutral-300">—</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3.5 text-xs text-neutral-500">{s.branchName ?? "—"}</td>
                          <td className="whitespace-nowrap px-3 py-3.5 text-right text-sm tabular-nums text-neutral-700">{formatMoney(s.openingCash)}</td>
                          <td className="whitespace-nowrap px-3 py-3.5 text-right text-sm tabular-nums text-neutral-700">
                            {formatMoney(s.cashCollected)}
                            {pending > 0 && (
                              <p className="text-[11px] font-medium text-amber-700">{formatMoney(s.pendingCash)} pending</p>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3.5 text-right text-sm tabular-nums text-neutral-500">{formatMoney(s.upiCollected)}</td>
                          <td className="whitespace-nowrap px-3 py-3.5 text-right text-sm tabular-nums text-neutral-700">{formatMoney(s.cashRefunded)}</td>
                          <td className="whitespace-nowrap px-3 py-3.5 text-right text-sm font-semibold tabular-nums text-neutral-900">{formatMoney(s.expectedClosing)}</td>
                          <td className="whitespace-nowrap px-3 py-3.5 text-right text-sm tabular-nums text-neutral-700">
                            {s.closingCash === null ? <span className="text-neutral-300">—</span> : formatMoney(s.closingCash)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3.5 text-right text-sm"><VarianceValue value={s.variance} /></td>
                          <td className="px-3 py-3.5">
                            <ShiftStatusBadge status={s.status} />
                            {s.reconciledAt && (
                              <p className="mt-1 whitespace-nowrap text-[11px] text-green-700">
                                Reconciled{s.reconciledByName ? ` by ${s.reconciledByName}` : ""}
                              </p>
                            )}
                            {s.legacyVariance && (
                              <p className="mt-1 inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-neutral-400" title={LEGACY_VARIANCE_NOTE}>
                                <Info className="h-3 w-3" /> Old variance rule
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-500">
              Showing <span className="font-medium text-neutral-700">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</span> of{" "}
              <span className="font-medium text-neutral-700">{total}</span>
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 text-sm text-neutral-600">Page {page} of {totalPages}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </main>

      <ShiftDetailSheet publicId={detailId} onClose={() => setDetailId(null)} load={loadMyShift} />
    </div>
  );
}
