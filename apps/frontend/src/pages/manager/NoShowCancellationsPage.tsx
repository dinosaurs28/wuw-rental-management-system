import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Ban,
  CalendarX2,
  CalendarRange,
  Archive,
  Clock4,
  Play,
  ChevronLeft,
  ChevronRight,
  Info,
  TrendingDown,
  Bot,
  User2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import {
  managerDashboardService,
  type CancellationStats,
  type CancelledBooking,
} from "@/services/managerDashboard.service";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtMoney(val: string | null | undefined) {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0 });
}

function isAuto(reason: string | null | undefined) {
  return reason?.toLowerCase().includes("auto-cancelled") ?? false;
}

type FilterPreset = "today" | "7d" | "30d" | "custom";

function getDateRange(preset: FilterPreset, customStart: string, customEnd: string) {
  const now = new Date();
  const pad = (d: Date) => d.toISOString().split("T")[0];
  if (preset === "today") {
    const s = pad(now);
    return { startDate: s, endDate: s };
  }
  if (preset === "7d") {
    const s = new Date(now);
    s.setDate(s.getDate() - 7);
    return { startDate: pad(s), endDate: pad(now) };
  }
  if (preset === "30d") {
    const s = new Date(now);
    s.setDate(s.getDate() - 30);
    return { startDate: pad(s), endDate: pad(now) };
  }
  return { startDate: customStart, endDate: customEnd };
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  loading,
  accent = false,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  loading: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-5 bg-white shadow-sm ${
        accent ? "border-orange-200" : "border-neutral-200"
      }`}
    >
      {accent && (
        <div className="pointer-events-none absolute -right-3 -top-3 h-16 w-16 rounded-full bg-orange-100 blur-xl" />
      )}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
            {label}
          </p>
          {loading ? (
            <div className="mt-2 h-8 w-20 animate-pulse rounded-md bg-neutral-100" />
          ) : (
            <p
              className={`mt-1 text-3xl font-bold tabular-nums ${
                accent ? "text-orange-500" : "text-neutral-900"
              }`}
            >
              {value.toLocaleString("en-IN")}
            </p>
          )}
        </div>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            accent
              ? "bg-orange-100 text-orange-500"
              : "bg-neutral-100 text-neutral-500"
          }`}
        >
          <Icon size={16} />
        </div>
      </div>
    </div>
  );
}

// ── Skeleton rows ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-neutral-100">
      {[100, 130, 150, 90, 120, 160, 70].map((w, i) => (
        <td key={i} className="px-5 py-4">
          <div
            className="h-3.5 animate-pulse rounded bg-neutral-100"
            style={{ width: w }}
          />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3 shadow-sm">
      {[140, 100, 160, 80].map((w, i) => (
        <div
          key={i}
          className="h-3.5 animate-pulse rounded bg-neutral-100"
          style={{ width: w }}
        />
      ))}
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
        <CalendarX2 size={28} />
      </div>
      <p className="text-sm font-semibold text-neutral-700">No cancellations found</p>
      <p className="mt-1 text-xs text-neutral-400">
        No bookings were cancelled in this period.
      </p>
    </div>
  );
}

// ── Mobile Booking Card ───────────────────────────────────────────────────────

function BookingCard({ b }: { b: CancelledBooking }) {
  const auto = isAuto(b.cancellationReason);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs text-orange-500 font-semibold">
          #{b.publicId.slice(-8).toUpperCase()}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            auto
              ? "bg-blue-50 text-blue-600"
              : "bg-neutral-100 text-neutral-600"
          }`}
        >
          {auto ? <Bot size={10} /> : <User2 size={10} />}
          {auto ? "Auto" : "Manual"}
        </span>
      </div>
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-neutral-900">{b.customer.user.name}</p>
        <p className="text-xs text-neutral-500">{b.customer.user.phone ?? b.customer.user.email}</p>
      </div>
      <div className="space-y-0.5">
        <p className="text-sm text-neutral-700">
          {b.items[0]?.vehicle
            ? `${b.items[0].vehicle.make} ${b.items[0].vehicle.model}`
            : "—"}
        </p>
        <p className="font-mono text-xs text-neutral-400">
          {b.items[0]?.vehicle?.regNo ?? "—"}
        </p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span>Rental: {fmtDate(b.startAt)}</span>
        <span>Cancelled: {fmtDate(b.cancelledAt)}</span>
      </div>
      <div className="flex items-center justify-between pt-1 border-t border-neutral-100">
        <p className="text-xs text-neutral-400 max-w-[60%] truncate" title={b.cancellationReason ?? ""}>
          {b.cancellationReason ?? "—"}
        </p>
        {b.cancellationInvoice ? (
          <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
            {fmtMoney(b.cancellationInvoice.cancellationFee)} forfeited
          </span>
        ) : (
          <span className="text-xs text-neutral-400">—</span>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NoShowCancellationsPage() {
  const queryClient = useQueryClient();

  const [preset, setPreset] = useState<FilterPreset>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [page, setPage] = useState(1);

  const dateRange = getDateRange(preset, customStart, customEnd);

  const statsQuery = useQuery<CancellationStats>({
    queryKey: ["cancellation-stats"],
    queryFn: () => managerDashboardService.getCancellationStats(),
    staleTime: 60_000,
  });

  const historyQuery = useQuery({
    queryKey: ["cancellation-history", preset, dateRange.startDate, dateRange.endDate, page],
    queryFn: () =>
      managerDashboardService.getCancellationHistory({
        startDate: dateRange.startDate || undefined,
        endDate: dateRange.endDate || undefined,
        page,
        limit: 15,
      }),
    staleTime: 30_000,
    enabled: preset !== "custom" || (!!customStart && !!customEnd),
  });

  const triggerMutation = useMutation({
    mutationFn: () => managerDashboardService.triggerNoShowAutoCancel(),
    onSuccess: (data) => {
      const count = data.cancelledCount;
      if (count === 0) {
        toast.info("No eligible bookings found to cancel.");
      } else {
        toast.success(`${count} booking${count > 1 ? "s" : ""} auto-cancelled successfully.`);
      }
      queryClient.invalidateQueries({ queryKey: ["cancellation-stats"] });
      queryClient.invalidateQueries({ queryKey: ["cancellation-history"] });
    },
    onError: () => {
      toast.error("Failed to run auto-cancellation. Please try again.");
    },
  });

  const stats = statsQuery.data;
  const history = historyQuery.data;
  const totalPages = history?.pagination.totalPages ?? 1;
  const bookings = history?.data ?? [];

  function handlePreset(p: FilterPreset) {
    setPreset(p);
    setPage(1);
  }

  const presets: { key: FilterPreset; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "7d", label: "Last 7 Days" },
    { key: "30d", label: "Last 30 Days" },
    { key: "custom", label: "Custom" },
  ];

  return (
    <ManagerLayout>
      <div className="min-h-screen bg-neutral-50 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-7xl space-y-6">

          {/* ── Header ── */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-xl font-bold text-neutral-900">Cancellation Dashboard</h1>
              <p className="mt-0.5 text-sm text-neutral-500">
                Auto-cancelled and manually cancelled booking history
              </p>
            </div>
            <Button
              onClick={() => triggerMutation.mutate()}
              disabled={triggerMutation.isPending}
              className="gap-2 bg-orange-500 hover:bg-orange-600 text-white shrink-0"
            >
              {triggerMutation.isPending ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <Play size={14} />
              )}
              {triggerMutation.isPending ? "Running…" : "Run Auto-Cancel Now"}
            </Button>
          </div>

          {/* ── Info Banner ── */}
          <div className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
            <Info size={15} className="mt-0.5 shrink-0 text-orange-500" />
            <p className="text-sm text-orange-700">
              Auto-cancellation runs daily at{" "}
              <span className="font-semibold">6:00 AM IST</span> for bookings
              24+ hours past their scheduled pickup with no customer check-in.
            </p>
          </div>

          {/* ── Stat Cards ── */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Today"
              value={stats?.todayCancelledCount ?? 0}
              icon={Clock4}
              loading={statsQuery.isLoading}
              accent
            />
            <StatCard
              label="Last 7 Days"
              value={stats?.last7DaysCancelledCount ?? 0}
              icon={CalendarRange}
              loading={statsQuery.isLoading}
            />
            <StatCard
              label="Last 30 Days"
              value={stats?.last30DaysCancelledCount ?? 0}
              icon={TrendingDown}
              loading={statsQuery.isLoading}
            />
            <StatCard
              label="All Time"
              value={stats?.totalCancelledCount ?? 0}
              icon={Archive}
              loading={statsQuery.isLoading}
            />
          </div>

          {/* ── Auto vs Manual Breakdown ── */}
          {stats && !statsQuery.isLoading && stats.totalCancelledCount > 0 && (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-neutral-200 bg-white px-5 py-3.5 shadow-sm text-sm">
              <span className="font-semibold text-neutral-600">Breakdown</span>
              <div className="h-4 w-px bg-neutral-200" />
              <span className="flex items-center gap-1.5 text-blue-600">
                <Bot size={13} />
                <span className="font-semibold">{stats.autoCancelledCount}</span>
                <span className="text-neutral-500">auto-cancelled</span>
              </span>
              <span className="flex items-center gap-1.5 text-neutral-700">
                <User2 size={13} />
                <span className="font-semibold">{stats.manualCancelledCount}</span>
                <span className="text-neutral-500">manual</span>
              </span>
            </div>
          )}

          {/* ── Filter Bar ── */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {presets.map((p) => (
                <button
                  key={p.key}
                  onClick={() => handlePreset(p.key)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                    preset === p.key
                      ? "bg-orange-500 text-white"
                      : "border border-neutral-300 text-neutral-600 hover:border-orange-400 hover:text-orange-500 bg-white"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <AnimatePresence>
              {preset === "custom" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex flex-wrap items-center gap-3"
                >
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-neutral-500">From</label>
                    <input
                      type="date"
                      value={customStart}
                      onChange={(e) => { setCustomStart(e.target.value); setPage(1); }}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-neutral-500">To</label>
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => { setCustomEnd(e.target.value); setPage(1); }}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                    />
                  </div>
                  {(customStart || customEnd) && (
                    <button
                      onClick={() => { setCustomStart(""); setCustomEnd(""); setPage(1); }}
                      className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700"
                    >
                      <X size={12} /> Clear
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── History Table (desktop) ── */}
          <div className="hidden md:block">
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
              <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Ban size={15} className="text-neutral-400" />
                  <h2 className="text-sm font-semibold text-neutral-900">Cancellation History</h2>
                </div>
                {history?.pagination.total != null && (
                  <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-600">
                    {history.pagination.total} total
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50/80">
                      {["Booking ID", "Customer", "Vehicle", "Rental Start", "Cancelled At", "Reason", "Forfeited"].map((h, i) => (
                        <th
                          key={h}
                          className={`px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 ${
                            i === 6 ? "text-right" : "text-left"
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {historyQuery.isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                    ) : bookings.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <EmptyState />
                        </td>
                      </tr>
                    ) : (
                      bookings.map((b) => {
                        const auto = isAuto(b.cancellationReason);
                        return (
                          <tr
                            key={b.publicId}
                            className="hover:bg-neutral-50 transition-colors"
                          >
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-semibold text-orange-500">
                                  #{b.publicId.slice(-8).toUpperCase()}
                                </span>
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                                    auto
                                      ? "bg-blue-50 text-blue-600"
                                      : "bg-neutral-100 text-neutral-500"
                                  }`}
                                >
                                  {auto ? <Bot size={9} /> : <User2 size={9} />}
                                  {auto ? "Auto" : "Manual"}
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <p className="text-sm font-medium text-neutral-900">{b.customer.user.name}</p>
                              <p className="text-xs text-neutral-500">
                                {b.customer.user.phone ?? b.customer.user.email}
                              </p>
                            </td>
                            <td className="px-5 py-4">
                              <p className="text-sm text-neutral-800">
                                {b.items[0]?.vehicle
                                  ? `${b.items[0].vehicle.make} ${b.items[0].vehicle.model}`
                                  : "—"}
                              </p>
                              <p className="font-mono text-xs text-neutral-400">
                                {b.items[0]?.vehicle?.regNo ?? "—"}
                              </p>
                            </td>
                            <td className="px-5 py-4 text-sm text-neutral-700">
                              {fmtDate(b.startAt)}
                            </td>
                            <td className="px-5 py-4 text-sm text-neutral-700">
                              {fmtDateTime(b.cancelledAt)}
                            </td>
                            <td className="max-w-[200px] px-5 py-4">
                              <p
                                className="truncate text-xs text-neutral-500"
                                title={b.cancellationReason ?? ""}
                              >
                                {b.cancellationReason ?? "—"}
                              </p>
                            </td>
                            <td className="px-5 py-4 text-right">
                              {b.cancellationInvoice ? (
                                <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">
                                  {fmtMoney(b.cancellationInvoice.cancellationFee)}
                                </span>
                              ) : (
                                <span className="text-xs text-neutral-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── History Cards (mobile) ── */}
          <div className="space-y-3 md:hidden">
            {historyQuery.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            ) : bookings.length === 0 ? (
              <EmptyState />
            ) : (
              bookings.map((b) => <BookingCard key={b.publicId} b={b} />)
            )}
          </div>

          {/* ── Pagination ── */}
          {!historyQuery.isLoading && bookings.length > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-neutral-500">
                Page {page} of {totalPages}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-300 text-neutral-500 transition-colors hover:border-orange-400 hover:text-orange-500 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                >
                  <ChevronLeft size={14} />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                  if (p > totalPages) return null;
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                        p === page
                          ? "bg-orange-500 text-white"
                          : "border border-neutral-300 text-neutral-600 hover:border-orange-400 hover:text-orange-500 bg-white"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-300 text-neutral-500 transition-colors hover:border-orange-400 hover:text-orange-500 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </ManagerLayout>
  );
}
