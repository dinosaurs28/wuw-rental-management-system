import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Info, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { PeriodRangeBar } from "@/components/manager/period/PeriodRangeBar";
import { PeriodKpiGrid, PeriodKpiGridSkeleton } from "@/components/manager/period/PeriodKpiGrid";
import {
  RentalPeriodBreakdown,
  SourceBreakdown,
} from "@/components/manager/period/PeriodBreakdowns";
import { PeriodTrendCard } from "@/components/manager/period/PeriodTrendCard";
import { PeriodBookingsTable } from "@/components/manager/period/PeriodBookingsTable";
import {
  DEFAULT_PRESET,
  formatYmdRange,
  isPeriodPreset,
  resolvePreset,
  validateCustomRange,
  type PeriodPreset,
} from "@/components/manager/period/periodRange";
import {
  managerPeriodReportService,
  periodBlobErrorMessage,
  periodErrorMessage,
  type PeriodGroupBy,
} from "@/services/managerPeriodReport.service";

const GROUP_BY_VALUES: PeriodGroupBy[] = ["auto", "day", "week", "month"];
const BOOKINGS_PAGE_SIZE = 25;

/**
 * Resolves the URL (?preset=&from=&to=&groupBy=) into the range to request.
 * Presets are recomputed on every visit (so "This month" stays current); a
 * custom range comes from the URL and falls back to the default when invalid.
 */
function useRangeParams() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPreset = searchParams.get("preset");
  const rawGroupBy = searchParams.get("groupBy") as PeriodGroupBy | null;
  const groupBy: PeriodGroupBy =
    rawGroupBy && GROUP_BY_VALUES.includes(rawGroupBy) ? rawGroupBy : "auto";

  let preset: PeriodPreset = isPeriodPreset(rawPreset) ? rawPreset : DEFAULT_PRESET;
  let from: string;
  let to: string;
  if (preset === "custom") {
    const f = searchParams.get("from") ?? "";
    const t = searchParams.get("to") ?? "";
    if (validateCustomRange(f, t) === null) {
      from = f;
      to = t;
    } else {
      preset = DEFAULT_PRESET;
      ({ from, to } = resolvePreset(DEFAULT_PRESET));
    }
  } else {
    ({ from, to } = resolvePreset(preset));
  }

  const update = (next: { preset?: PeriodPreset; from?: string; to?: string; groupBy?: PeriodGroupBy }) => {
    const p = next.preset ?? preset;
    const g = next.groupBy ?? groupBy;
    const params: Record<string, string> = { preset: p };
    if (p === "custom") {
      params.from = next.from ?? from;
      params.to = next.to ?? to;
    }
    if (g !== "auto") params.groupBy = g;
    setSearchParams(params, { replace: true });
  };

  return { preset, from, to, groupBy, update };
}

export function PeriodReportPage() {
  const queryClient = useQueryClient();
  const { preset, from, to, groupBy, update } = useRangeParams();
  const [downloadingTrend, setDownloadingTrend] = useState(false);

  const reportQuery = useQuery({
    queryKey: ["bm-period-report", from, to, groupBy],
    queryFn: () =>
      managerPeriodReportService.getReport({ from, to, groupBy, pageSize: BOOKINGS_PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const report = reportQuery.data;
  const stale = reportQuery.isPlaceholderData;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["bm-period-report"] });
    void queryClient.invalidateQueries({ queryKey: ["bm-period-bookings"] });
  };

  const downloadTrend = async () => {
    if (!report) return;
    setDownloadingTrend(true);
    const toastId = toast.loading("Preparing trend CSV…");
    try {
      await managerPeriodReportService.downloadCsv({ from, to, groupBy }, "trend", report.range.groupBy);
      toast.success("Trend CSV downloaded", { id: toastId });
    } catch (error) {
      toast.error(await periodBlobErrorMessage(error, "Could not download the CSV."), {
        id: toastId,
      });
    } finally {
      setDownloadingTrend(false);
    }
  };

  return (
    <ManagerLayout>
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12 space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <Breadcrumb className="mb-2">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Period</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">
              Period
            </h1>
            <p className="text-sm text-neutral-500 mt-1">
              {report ? (
                <>
                  <span className="font-medium text-neutral-700">{report.branch.name}</span>
                  {" · "}
                  {formatYmdRange(report.range.from, report.range.to)} (IST) · {report.range.days}{" "}
                  day{report.range.days === 1 ? "" : "s"}
                </>
              ) : (
                "Bookings, money and activity for your branch over any period."
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {report && (
              <span className="text-xs text-neutral-400 tabular-nums">
                Updated{" "}
                {new Date(report.generatedAt).toLocaleTimeString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                })}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={refresh}
              disabled={reportQuery.isFetching}
            >
              <RefreshCw className={reportQuery.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              Refresh
            </Button>
          </div>
        </div>

        <PeriodRangeBar
          key={preset === "custom" ? `custom-${from}-${to}` : preset}
          preset={preset}
          from={from}
          to={to}
          groupBy={groupBy}
          onPresetChange={(p) => update({ preset: p })}
          onCustomApply={(f, t) => update({ preset: "custom", from: f, to: t })}
          onGroupByChange={(g) => update({ groupBy: g })}
        />

        {reportQuery.isError && !report ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-10 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-red-400" />
            <p className="mt-2 text-sm font-medium text-red-700">
              {periodErrorMessage(reportQuery.error, "Could not load the period report. Please try again.")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => reportQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : !report ? (
          <div className="space-y-5">
            <PeriodKpiGridSkeleton />
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <Skeleton className="h-[320px] rounded-2xl lg:col-span-3" />
              <Skeleton className="h-[320px] rounded-2xl lg:col-span-2" />
            </div>
            <Skeleton className="h-[360px] rounded-2xl" />
            <Skeleton className="h-[420px] rounded-2xl" />
          </div>
        ) : (
          <div className={stale ? "space-y-5 opacity-60 transition-opacity" : "space-y-5 transition-opacity"}>
            {reportQuery.isError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {periodErrorMessage(reportQuery.error, "Could not refresh the period report.")}
              </div>
            )}

            <PeriodKpiGrid report={report} />

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div className="lg:col-span-3">
                <RentalPeriodBreakdown rows={report.byRentalPeriod} />
              </div>
              <div className="lg:col-span-2">
                <SourceBreakdown rows={report.bySource} />
              </div>
            </div>

            <PeriodTrendCard
              trend={report.trend}
              groupBy={report.range.groupBy}
              onDownload={downloadTrend}
              downloading={downloadingTrend}
            />

            <PeriodBookingsTable
              from={from}
              to={to}
              groupBy={groupBy}
              initial={report.bookings}
              initialStale={stale}
            />

            {/* Definitions — these figures count different things on different dates. */}
            <div className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Info className="h-4 w-4 text-orange-500" />
                <h2 className="text-sm font-semibold text-neutral-900">How these numbers are counted</h2>
              </div>
              <ul className="grid gap-x-8 gap-y-1.5 text-xs text-neutral-500 md:grid-cols-2 list-disc pl-4">
                <li>
                  <span className="font-medium text-neutral-700">Bookings, Booking value, Outstanding</span>, the
                  breakdowns and the list cover bookings whose <em>start date</em> is in the period
                  (confirmed, active and completed; the list can also show cancelled ones).
                </li>
                <li>
                  <span className="font-medium text-neutral-700">Booking value</span> includes confirmed
                  extensions and the refundable deposit, and excludes charges added at return (extra km,
                  late return, fuel, damage).
                </li>
                <li>
                  <span className="font-medium text-neutral-700">Collected</span> is money received in the
                  period for any booking (safety deposits excluded), so it will not match Booking value.
                </li>
                <li>
                  <span className="font-medium text-neutral-700">Outstanding</span> is the unpaid part of
                  those bookings&apos; value, after every payment received up to now.
                </li>
                <li>
                  <span className="font-medium text-neutral-700">Cancellations</span> count by cancellation
                  date, <span className="font-medium text-neutral-700">returns</span> by return date,{" "}
                  <span className="font-medium text-neutral-700">extensions</span> by request date
                  (confirmed only) and <span className="font-medium text-neutral-700">refunds</span> by
                  completion date.
                </li>
                <li>
                  Days run midnight to midnight IST. Online = booked by the customer; Counter = created by
                  staff or a manager.
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </ManagerLayout>
  );
}
