import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, X, CalendarDays, ChevronLeft, ChevronRight, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { ShiftStatusBadge } from "@/components/manager/payment/PaymentStateBadge";
import { ShiftDetailSheet, ShiftMoneyBreakdown } from "@/components/manager/payment/ShiftDetailSheet";
import { TotalsStrip, VarianceValue } from "@/components/manager/payment/ShiftTotals";
import {
  LEGACY_VARIANCE_NOTE,
  addIstDays,
  formatIstDateTime,
  formatIstDay,
  formatMoney,
  istToday,
  toPaise,
} from "@/components/manager/payment/cashShiftFormat";
import { apiErrorMessage } from "@/lib/counterErrors";
import {
  paymentService,
  type BranchShiftRow,
  type ShiftDayTotals,
  type ShiftListFilters,
  type ShiftListStatus,
  type ShiftView,
} from "@/services/payment.service";
import { managerDashboardService, type Employee } from "@/services/managerDashboard.service";

const loadBranchShift = (publicId: string) => paymentService.getShift(publicId);

// ── Reconcile Modal ───────────────────────────────────────────────────────────

function ReconcileModal({ shift, onClose, onDone }: { shift: ShiftView; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const handleReconcile = async () => {
    if ((note || "").trim().length < 10) { toast.error("Manager note must be at least 10 characters."); return; }
    setLoading(true);
    try {
      await paymentService.reconcileShift(shift.publicId, note.trim());
      toast.success("Shift reconciled.");
      onDone();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Failed to reconcile shift."));
    } finally { setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
        <div className="px-6 py-5 border-b border-neutral-100 bg-neutral-50/60">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Reconcile Shift</DialogTitle>
            <p className="text-xs text-neutral-500 mt-0.5">
              {shift.employeeName} · Opened {formatIstDateTime(shift.openedAt, true)}
              {shift.closedAt ? ` · Closed ${formatIstDateTime(shift.closedAt, true)}` : ""}
            </p>
          </DialogHeader>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Server figures — never recomputed here */}
          <ShiftMoneyBreakdown shift={shift} />

          {shift.discrepancyExplanation && (
            <div>
              <p className="text-xs text-neutral-500 mb-1.5 font-medium">Fleet Executive's Explanation</p>
              <p className="text-sm text-neutral-800 bg-neutral-50 border border-neutral-100 rounded-xl px-4 py-3 italic leading-relaxed">
                "{shift.discrepancyExplanation}"
              </p>
            </div>
          )}

          <div className="flex items-start gap-2 bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-sm text-orange-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-orange-500" />
            Review the discrepancy and add a manager note to reconcile this shift.
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-neutral-600">Manager Reconciliation Note <span className="text-red-500">*</span></Label>
            <Textarea
              placeholder="e.g. Verified with employee — customer shortfall noted. Acceptable."
              rows={3}
              className="resize-none text-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {(note || "").length > 0 && (note || "").trim().length < 10 && (
              <p className="text-xs text-red-500">Minimum 10 characters required.</p>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-neutral-100 bg-neutral-50/40 gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button className="bg-orange-500 hover:bg-orange-600 text-white" onClick={handleReconcile} disabled={loading}>
            {loading ? "Reconciling…" : "Mark as Reconciled"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Daily totals ──────────────────────────────────────────────────────────────

function DailyTotalsTable({
  days,
  onPickDay,
}: {
  days: Array<ShiftDayTotals & { date: string }>;
  onPickDay: (day: string) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
      <div className="flex flex-col gap-0.5 border-b border-neutral-100 px-5 py-3 sm:flex-row sm:items-baseline sm:justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">Daily totals</h3>
        <span className="text-[11px] text-neutral-500">By the IST day each shift opened · click a day to see its shifts</span>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-neutral-50">
            <tr className="border-b border-neutral-100">
              {["Day", "Shifts", "Opening", "Collected", "Refunded", "UPI", "Expected", "Counted", "Variance"].map((h, i) => (
                <th
                  key={h}
                  className={`whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 ${i === 0 ? "text-left" : "text-right"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {days.map((d) => {
              const ended = d.closedCount + d.flaggedCount > 0;
              // Old-rule closes are left out of the day's variance sum
              const legacy = d.legacyCount ?? 0;
              const varianceCovered = d.closedCount + d.flaggedCount - legacy > 0;
              return (
                <tr
                  key={d.date}
                  className="cursor-pointer hover:bg-neutral-50/60"
                  tabIndex={0}
                  onClick={() => onPickDay(d.date)}
                  onKeyDown={(e) => { if (e.key === "Enter") onPickDay(d.date); }}
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs font-medium text-neutral-800">{formatIstDay(d.date)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-neutral-700">
                    {d.shiftCount}
                    {d.openCount > 0 && <span className="text-blue-600"> · {d.openCount} open</span>}
                    {d.flaggedCount > 0 && <span className="text-red-600"> · {d.flaggedCount} flagged</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs tabular-nums text-neutral-700">{formatMoney(d.openingCash)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs tabular-nums text-neutral-700">{formatMoney(d.cashCollected)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs tabular-nums text-neutral-700">{formatMoney(d.cashRefunded)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs tabular-nums text-neutral-700">{formatMoney(d.upiCollected)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold tabular-nums text-neutral-800">{formatMoney(d.expectedClosing)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs tabular-nums text-neutral-700">{ended ? formatMoney(d.closingCash) : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs" title={legacy > 0 ? LEGACY_VARIANCE_NOTE : undefined}>
                    <VarianceValue value={varianceCovered ? d.variance : null} />
                    {legacy > 0 && <span className="block text-[10px] text-neutral-400">{legacy} old-rule left out</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

type DateMode = "day" | "range";
type StatusChip = "ALL" | ShiftListStatus;

const STATUS_CHIPS: Array<{ value: StatusChip; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "ENDED", label: "Closed" },
  { value: "DISCREPANCY_FLAGGED", label: "Flagged" },
];

const ALL_EXECUTIVES = "__all__";

export function CashShiftsTab() {
  const today = istToday();
  const [shifts, setShifts] = useState<BranchShiftRow[]>([]);
  const [dailyTotals, setDailyTotals] = useState<Array<ShiftDayTotals & { date: string }>>([]);
  const [summary, setSummary] = useState<ShiftDayTotals | null>(null);
  const [openNowCount, setOpenNowCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  // Filters — days are IST calendar dates (the day a shift opened).
  const [dateMode, setDateMode] = useState<DateMode>("day");
  const [day, setDay] = useState(today);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [statusChip, setStatusChip] = useState<StatusChip>("ALL");
  const [openNow, setOpenNow] = useState(false);
  const [executive, setExecutive] = useState(ALL_EXECUTIVES);
  const [executives, setExecutives] = useState<Employee[]>([]);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailReloadKey, setDetailReloadKey] = useState(0);
  const [selected, setSelected] = useState<ShiftView | null>(null);

  const requestSeq = useRef(0);

  const rangeError =
    !openNow && dateMode === "range" && fromDate && toDate && fromDate > toDate
      ? "The from date must be on or before the to date."
      : null;

  useEffect(() => {
    managerDashboardService
      .getEmployees(200)
      .then(setExecutives)
      .catch(() => setExecutives([]));
  }, []);

  const load = useCallback(async () => {
    if (rangeError) return;
    const filters: ShiftListFilters = {};
    if (openNow) {
      filters.openNow = true;
    } else {
      if (statusChip !== "ALL") filters.status = statusChip;
      if (dateMode === "day") {
        if (day) filters.date = day;
      } else {
        if (fromDate) filters.from = fromDate;
        if (toDate) filters.to = toDate;
      }
    }
    if (executive !== ALL_EXECUTIVES) filters.employeePublicId = executive;

    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await paymentService.getAllShifts(page, pageSize, filters);
      if (seq !== requestSeq.current) return;
      setShifts(res.data);
      setTotal(res.total);
      setDailyTotals(res.dailyTotals);
      setSummary(res.summary);
      setOpenNowCount(res.openNowCount);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setShifts([]);
      setTotal(0);
      setDailyTotals([]);
      setSummary(null);
      setLoadError(apiErrorMessage(err, "Failed to load shifts."));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [page, openNow, statusChip, dateMode, day, fromDate, toDate, executive, rangeError]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / pageSize);

  const switchDateMode = (mode: DateMode) => {
    if (mode === dateMode) return;
    if (mode === "range") {
      setFromDate(day || today);
      setToDate(day || today);
    } else {
      setDay(toDate || fromDate || today);
    }
    setDateMode(mode);
    setPage(1);
  };

  const pickDay = (d: string) => {
    setOpenNow(false);
    setDateMode("day");
    setDay(d);
    setPage(1);
  };

  const periodLabel = openNow
    ? "Open right now"
    : dateMode === "day"
      ? day ? formatIstDay(day) : "All dates"
      : fromDate && toDate
        ? `${formatIstDay(fromDate)} – ${formatIstDay(toDate)}`
        : fromDate
          ? `From ${formatIstDay(fromDate)}`
          : toDate
            ? `Up to ${formatIstDay(toDate)}`
            : "All dates";

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="flex-1">
            <h2 className="text-base font-semibold text-neutral-900">Cash Shifts</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Fleet Executive cash shifts for this branch. Expected in drawer = opening cash + cash collected − cash refunded.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-9 gap-1.5 text-xs self-start sm:self-auto">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_CHIPS.map((chip) => {
              const active = !openNow && statusChip === chip.value;
              return (
                <button
                  key={chip.value}
                  type="button"
                  onClick={() => { setOpenNow(false); setStatusChip(chip.value); setPage(1); }}
                  className={`h-8 rounded-full border px-3.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
            <span className="mx-1 hidden h-5 w-px bg-neutral-200 sm:block" />
            <button
              type="button"
              onClick={() => { setOpenNow((v) => !v); setPage(1); }}
              title="Every shift open right now, from any day"
              className={`h-8 rounded-full border px-3.5 text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
                openNow
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${openNow ? "bg-white" : "bg-blue-500"}`} />
              Open now ({openNowCount})
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className={`flex flex-wrap items-end gap-3 ${openNow ? "pointer-events-none opacity-40" : ""}`} aria-disabled={openNow}>
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" /> Dates (IST)
                </span>
                <div className="inline-flex h-9 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
                  {(["day", "range"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => switchDateMode(mode)}
                      className={`rounded-md px-3 text-xs font-medium transition-colors ${
                        dateMode === mode ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
                      }`}
                    >
                      {mode === "day" ? "Single day" : "Range"}
                    </button>
                  ))}
                </div>
              </div>

              {dateMode === "day" ? (
                <div className="flex items-end gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-label="Previous day"
                    onClick={() => { setDay(addIstDays(day || today, -1)); setPage(1); }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Input
                    type="date"
                    value={day}
                    max={today}
                    onChange={(e) => { setDay(e.target.value); setPage(1); }}
                    className="h-9 w-40 text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-label="Next day"
                    disabled={!!day && day >= today}
                    onClick={() => { setDay(addIstDays(day || today, 1)); setPage(1); }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  {day !== today && (
                    <Button variant="ghost" size="sm" className="h-9 text-xs text-neutral-600" onClick={() => { setDay(today); setPage(1); }}>
                      Today
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">From</span>
                    <Input type="date" value={fromDate} max={toDate || today} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} className="h-9 w-40 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">To</span>
                    <Input type="date" value={toDate} min={fromDate || undefined} max={today} onChange={(e) => { setToDate(e.target.value); setPage(1); }} className="h-9 w-40 text-sm" />
                  </div>
                  {(fromDate || toDate) && (
                    <Button variant="ghost" size="sm" className="h-9 text-neutral-500 hover:text-neutral-700 gap-1" onClick={() => { setFromDate(""); setToDate(""); setPage(1); }}>
                      <X className="w-3.5 h-3.5" /> All dates
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">Fleet Executive</span>
              <Select value={executive} onValueChange={(v) => { setExecutive(v); setPage(1); }}>
                <SelectTrigger className="h-9 w-full sm:w-56 bg-white text-sm">
                  <SelectValue placeholder="All Fleet Executives" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_EXECUTIVES}>All Fleet Executives</SelectItem>
                  {executives.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {openNow && (
            <p className="flex items-center gap-1.5 text-xs text-blue-700">
              <Info className="h-3.5 w-3.5" /> Showing every shift open right now, including ones opened on an earlier day. Dates and status are ignored.
            </p>
          )}
          {rangeError && <p className="text-xs text-red-600">{rangeError}</p>}
        </div>

        {/* Totals over the whole filter */}
        {summary && summary.shiftCount > 0 && !loadError && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-neutral-500">
              Totals · <span className="text-neutral-800">{periodLabel}</span>
            </p>
            <TotalsStrip totals={summary} />
          </div>
        )}

        {dailyTotals.length > 1 && !loadError && (
          <DailyTotalsTable days={dailyTotals} onPickDay={pickDay} />
        )}

        {/* Table */}
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          {loading ? (
            <div className="divide-y divide-neutral-100">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-28" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-32 flex-1" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-24" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-20" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-16" />
                  <div className="h-6 bg-neutral-100 rounded-full animate-pulse w-24" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <AlertTriangle className="w-6 h-6 text-red-400" />
              <p className="text-sm text-neutral-700">{loadError}</p>
              <Button variant="outline" size="sm" onClick={load} className="gap-1.5 text-xs">
                <RefreshCw className="w-3.5 h-3.5" /> Try again
              </Button>
            </div>
          ) : (!shifts || shifts.length === 0) ? (
            <div className="py-20 flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mb-3">
                <CalendarDays className="w-6 h-6 text-neutral-400" />
              </div>
              <p className="font-medium text-neutral-700">{openNow ? "No shift is open right now" : "No shifts for these filters"}</p>
              <p className="text-sm text-neutral-400 mt-1">
                {openNow ? "Shifts appear here while a Fleet Executive has one open." : `Nothing opened on ${periodLabel}.`}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/80">
                    {[
                      ["Fleet Executive", "left"],
                      ["Opened", "left"],
                      ["Closed", "left"],
                      ["Opening cash", "right"],
                      ["Cash collected", "right"],
                      ["UPI collected", "right"],
                      ["Refunds", "right"],
                      ["Expected", "right"],
                      ["Counted", "right"],
                      ["Variance", "right"],
                      ["Status", "left"],
                      ["", "right"],
                    ].map(([h, align], i) => (
                      <th
                        key={i}
                        className={`whitespace-nowrap px-4 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide ${align === "right" ? "text-right" : "text-left"}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(shifts || []).map((shift) => {
                    const isDiscrepancy = shift.status === "DISCREPANCY_FLAGGED";
                    const pending = toPaise(shift.pendingCash);
                    return (
                      <tr
                        key={shift.publicId}
                        tabIndex={0}
                        onClick={() => setDetailId(shift.publicId)}
                        onKeyDown={(e) => { if (e.key === "Enter") setDetailId(shift.publicId); }}
                        className={`cursor-pointer hover:bg-neutral-50/60 transition-colors ${isDiscrepancy ? "border-l-4 border-l-red-400" : shift.isOpen ? "border-l-4 border-l-blue-300" : ""}`}
                      >
                        <td className="px-4 py-3.5">
                          <p className="whitespace-nowrap font-medium text-neutral-900 text-sm">{shift.employeeName}</p>
                          <p className="text-[11px] text-neutral-400">
                            {shift.transactionCount} {shift.transactionCount === 1 ? "transaction" : "transactions"}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-xs text-neutral-500">{formatIstDateTime(shift.openedAt)}</td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-xs text-neutral-500">
                          {shift.closedAt ? formatIstDateTime(shift.closedAt) : <span className="text-neutral-300">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right text-sm tabular-nums text-neutral-700">{formatMoney(shift.openingCash)}</td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right text-sm tabular-nums text-neutral-700">
                          {formatMoney(shift.cashCollected)}
                          {pending > 0 && (
                            <p className="text-[11px] font-medium text-amber-700">{formatMoney(shift.pendingCash)} pending</p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right text-sm tabular-nums text-neutral-500">{formatMoney(shift.upiCollected)}</td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right text-sm tabular-nums text-neutral-700">{formatMoney(shift.cashRefunded)}</td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right text-sm font-semibold tabular-nums text-neutral-900">{formatMoney(shift.expectedClosing)}</td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right text-sm tabular-nums text-neutral-700">
                          {shift.closingCash === null ? <span className="text-neutral-300">—</span> : formatMoney(shift.closingCash)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right text-sm"><VarianceValue value={shift.variance} /></td>
                        <td className="px-4 py-3.5">
                          <ShiftStatusBadge status={shift.status} />
                          {shift.reconciledAt && (
                            <p className="mt-1 whitespace-nowrap text-[11px] text-green-700">
                              Reconciled{shift.reconciledByName ? ` by ${shift.reconciledByName}` : ""}
                            </p>
                          )}
                          {shift.legacyVariance && (
                            <p className="mt-1 inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-neutral-400" title={LEGACY_VARIANCE_NOTE}>
                              <Info className="h-3 w-3" /> Old variance rule
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {isDiscrepancy && (
                            <Button
                              size="sm"
                              className="h-8 text-xs bg-orange-500 hover:bg-orange-600 text-white px-3"
                              onClick={(e) => { e.stopPropagation(); setSelected(shift); }}
                            >
                              Reconcile
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-500">
              Showing <span className="font-medium text-neutral-700">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</span> of <span className="font-medium text-neutral-700">{total}</span>
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="text-sm text-neutral-600 px-2">Page {page} of {totalPages}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </div>

      <ShiftDetailSheet
        publicId={detailId}
        onClose={() => setDetailId(null)}
        load={loadBranchShift}
        onReconcile={(shift) => setSelected(shift)}
        reloadKey={detailReloadKey}
      />

      {selected && (
        <ReconcileModal
          shift={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            setDetailReloadKey((k) => k + 1);
            load();
          }}
        />
      )}
    </>
  );
}
