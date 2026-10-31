import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, FileWarning, RefreshCw, Wrench, Receipt } from "lucide-react";
import apiClient from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MetricCard,
  ReportFilterBar,
  formatINR,
  reportFilterSearch,
  useReportFilters,
  type Delta,
  type ReportFilterState,
} from "@/components/admin/reports/framework";
import { reportById } from "@/pages/admin/reports/reportRegistry";

/** Shape of GET /admin/dashboard/reports/home (controller/admin/reports/dashboardHome.controller.ts). */
interface RevenueBlock {
  total: number;
  bookingValue: number;
  rent: number;
  extras: number;
  deposit: number;
  goodwill: number;
  bookings: number;
}
export interface DashboardHomeData {
  asOf: string;
  periods: {
    today: { from: string; to: string; label: string };
    mtd: { from: string; to: string; label: string };
    previousMtd: { from: string; to: string; label: string };
  };
  revenue: { today: RevenueBlock; mtd: RevenueBlock; previousMtd: RevenueBlock; mtdDelta: Delta; bookingValueDelta: Delta; rule: string };
  fleet: { total: number; onRent: number; available: number; maintenance: number; reported: number; inactive: number; rule: string };
  utilization: { pct: number | null; rentedDays: number; availableDays: number; downtimeDays: number; from: string; to: string; notes: string[] };
  today: { pickupsScheduled: number; pickupsDone: number; pickupsPending: number; returnsScheduled: number; returnsDone: number; returnsPending: number };
  overdue: { count: number; top: { publicId: string; branchName: string; customer: string | null; regNo: string | null; endAt: string; overdueMinutes: number }[] };
  dues: { total: number; customers: number; bookings: number; awaitingConfirmation: number; buckets: { d0_7: number; d8_30: number; d31plus: number } };
  alerts: {
    documents: {
      tracked: boolean;
      withinDays: number;
      expired: number;
      expiring7: number;
      expiring30: number;
      total: number;
      top: { regNo: string; docType: string; expiryDate: string; daysLeft: number; status: string }[];
    };
    servicing: { tracked: boolean; note: string };
    challans: { tracked: boolean; note: string };
  };
}

/** Path of a report by its spec id (from the hub registry). */
const reportPath = (id: string): string => reportById(id)?.path ?? "/admin/reports/hub";

const hoursLabel = (min: number) => (min >= 1440 ? `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h` : `${Math.floor(min / 60)}h ${min % 60}m`);

/**
 * Dashboard Home (spec §1): today's & month-to-date revenue (same rule as the Revenue
 * Summary), fleet status, utilization, today's pickups/returns, overdue returns,
 * outstanding dues and alerts. Every tile links to its detailed report with the
 * current branch / category / vehicle filter carried over.
 */
export const DashboardHome = () => {
  const { filters, setFilters, params } = useReportFilters({ defaultPreset: "thisMonth" });
  const [data, setData] = useState<DashboardHomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      try {
        setLoading(true);
        setError(null);
        const { preset: _p, from: _f, to: _t, ...scope } = params;
        const r = await apiClient.get<DashboardHomeData>("/admin/dashboard/reports/home", {
          params: { ...scope, ...(refresh ? { refresh: 1 } : {}) },
        });
        setData(r.data);
      } catch (e: unknown) {
        setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Failed to load the dashboard");
      } finally {
        setLoading(false);
      }
    },
    [params],
  );

  useEffect(() => {
    load();
  }, [load]);

  /** Deep link into a report keeping the dashboard's scope filters. */
  const link = (path: string, preset: ReportFilterState["preset"] = "thisMonth") =>
    `${path}?${reportFilterSearch({ ...filters, preset, from: "", to: "" })}`;

  const d = data;
  const mtdLabel = d?.periods.previousMtd.label;

  return (
    <section className="mb-10" data-testid="dashboard-home">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Today at a glance</h2>
          <p className="text-xs text-neutral-500">
            {d ? `As of ${new Date(d.asOf).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST · month to date ${d.periods.mtd.label}` : "Loading…"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-9" onClick={() => load(true)} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button asChild variant="outline" className="h-9">
            <Link to="/admin/reports/hub">All reports</Link>
          </Button>
        </div>
      </div>

      <ReportFilterBar value={filters} onChange={setFilters} show={{ dates: false }} className="mb-4" />

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}{" "}
          <button className="underline" onClick={() => load(true)}>
            Retry
          </button>
        </div>
      )}

      {/* Revenue */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          testId="dash-revenue-today"
          label="Today's revenue"
          value={d?.revenue.today.total}
          format="money"
          loading={loading && !d}
          hint={d ? `${d.revenue.today.bookings} rental(s) starting today` : undefined}
          to={link(reportPath("2.1"), "today")}
        />
        <MetricCard
          testId="dash-revenue-mtd"
          label="Revenue · month to date"
          value={d?.revenue.mtd.total}
          format="money"
          delta={d?.revenue.mtdDelta}
          compareLabel={mtdLabel}
          loading={loading && !d}
          to={link(reportPath("2.1"), "thisMonth")}
        />
        <MetricCard
          testId="dash-booking-value"
          label="Booking value · MTD"
          value={d?.revenue.mtd.bookingValue}
          format="money"
          delta={d?.revenue.bookingValueDelta}
          compareLabel={mtdLabel}
          hint="Σ booking totals incl. refundable deposit (= Sales report)"
          loading={loading && !d}
          to={`/admin/reports/sales`}
        />
        <MetricCard
          testId="dash-dues"
          label="Outstanding customer dues"
          value={d?.dues.total}
          format="money"
          invert
          tone={d && d.dues.total > 0 ? "warning" : "default"}
          hint={
            d
              ? `${d.dues.customers} customer(s) · ${d.dues.bookings} rental(s)${d.dues.awaitingConfirmation > 0 ? ` · ${formatINR(d.dues.awaitingConfirmation)} cash awaiting confirmation` : ""}`
              : undefined
          }
          loading={loading && !d}
          to={link(reportPath("2.3"))}
        />
      </div>

      {/* Fleet + operations */}
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <MetricCard testId="dash-on-rent" label="On rent" value={d?.fleet.onRent} loading={loading && !d} hint={d ? `of ${d.fleet.total} vehicles` : undefined} to={link(reportPath("4.1"))} />
        <MetricCard testId="dash-available" label="Available" value={d?.fleet.available} loading={loading && !d} to={link(reportPath("4.2"))} />
        <MetricCard
          testId="dash-maintenance"
          label="Under maintenance"
          value={d ? d.fleet.maintenance + d.fleet.reported : undefined}
          loading={loading && !d}
          hint={d && d.fleet.reported > 0 ? `incl. ${d.fleet.reported} awaiting damage review` : undefined}
          to={link(reportPath("5.2"))}
        />
        <MetricCard
          testId="dash-utilization"
          label="Utilization · this month"
          value={d?.utilization.pct}
          format="percent"
          loading={loading && !d}
          hint={d ? `${d.utilization.rentedDays} of ${d.utilization.availableDays} available days` : undefined}
          to={link(reportPath("4.1"))}
        />
        <MetricCard
          testId="dash-pickups"
          label="Pickups today"
          value={d?.today.pickupsScheduled}
          loading={loading && !d}
          hint={d ? `${d.today.pickupsDone} done · ${d.today.pickupsPending} pending` : undefined}
          to={link(reportPath("3.1"), "today")}
        />
        <MetricCard
          testId="dash-returns"
          label="Returns today"
          value={d?.today.returnsScheduled}
          loading={loading && !d}
          hint={d ? `${d.today.returnsDone} back · ${d.today.returnsPending} pending` : undefined}
          to={link("/admin/reports/daily-summary", "today")}
        />
        <MetricCard
          testId="dash-overdue"
          label="Overdue returns"
          value={d?.overdue.count}
          invert
          tone={d && d.overdue.count > 0 ? "danger" : "default"}
          loading={loading && !d}
          to={link(reportPath("3.5"))}
        />
      </div>

      {/* Alerts */}
      <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-neutral-500">Alerts</h3>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Link to={link(reportPath("6.1"))} className="group block rounded-xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-[#FF5F00]/60" data-testid="dash-alert-documents">
          <p className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
            <FileWarning className="h-4 w-4 text-amber-500" /> Vehicle documents · next 30 days
          </p>
          {!d ? (
            <Skeleton className="mt-2 h-10 w-full" />
          ) : (
            <>
              <div className="mt-2 flex gap-4 text-sm">
                <span className="font-semibold text-rose-600">{d.alerts.documents.expired} expired</span>
                <span className="font-semibold text-amber-600">{d.alerts.documents.expiring7} in 7 days</span>
                <span className="text-neutral-600">{d.alerts.documents.expiring30} in 8–30 days</span>
              </div>
              <ul className="mt-2 space-y-0.5 text-xs text-neutral-500">
                {d.alerts.documents.top.map((r, i) => (
                  <li key={i}>
                    {r.regNo} · {r.docType} · {r.daysLeft < 0 ? `expired ${-r.daysLeft}d ago` : `${r.daysLeft}d left`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Link>
        <div className="rounded-xl border border-dashed border-neutral-200 bg-white p-4" data-testid="dash-alert-servicing">
          <p className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
            <Wrench className="h-4 w-4 text-neutral-400" /> Upcoming servicing
          </p>
          <p className="mt-2 text-sm font-semibold text-neutral-400">Not tracked yet</p>
          <p className="mt-1 text-xs text-neutral-500">{d?.alerts.servicing.note}</p>
        </div>
        <div className="rounded-xl border border-dashed border-neutral-200 bg-white p-4" data-testid="dash-alert-challans">
          <p className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
            <Receipt className="h-4 w-4 text-neutral-400" /> Unpaid traffic fines / challans
          </p>
          <p className="mt-2 text-sm font-semibold text-neutral-400">Not tracked yet</p>
          <p className="mt-1 text-xs text-neutral-500">{d?.alerts.challans.note}</p>
        </div>
      </div>

      {d && d.overdue.top.length > 0 && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-rose-700">
            <AlertTriangle className="h-4 w-4" /> Most overdue
          </p>
          <ul className="mt-2 grid gap-1 text-xs text-neutral-700 sm:grid-cols-2">
            {d.overdue.top.map((o) => (
              <li key={o.publicId}>
                {o.regNo ?? "—"} · {o.customer ?? "—"} · {o.branchName} · {hoursLabel(o.overdueMinutes)} late
              </li>
            ))}
          </ul>
        </div>
      )}

      {d && <p className="mt-3 text-[11px] text-neutral-400">{d.revenue.rule}</p>}
    </section>
  );
};
