import { useState } from "react";
import { ExportCsvButton, MetricCard, ReportFilterBar, ReportLayout, formatINR, formatNumber, useReportFilters } from "@/components/admin/reports/framework";
import {
  BookingPager,
  Chooser,
  LoadState,
  REPORTS_API,
  RowTable,
  Section,
  compareLabel,
  hours,
  istDateTime,
  minutesText,
  moneyOr,
  useBookingReport,
  usePageReset,
  type BookingBase,
  type BookingPagination,
  type Deltas,
  type PeriodInfo,
} from "./bookingsShared";

interface Data {
  period: PeriodInfo;
  summary: {
    bookings: number;
    extendedBookings: number;
    extensions: number;
    extensionAmount: number;
    extensionHours: number;
    extendedRatePct: number | null;
    completedBookings: number;
    lateReturns: number;
    lateRatePct: number | null;
    avgLateMinutes: number | null;
    lateReturnsNotCharged: number;
    lateFeeCharged: number;
    lateFeeCollected: number;
    lateFeeFromDeposit: number;
    lateFeeDifference: number;
    overdueNow: number;
  };
  deltas: Deltas;
  rows: Array<
    BookingBase & {
      statusLabel: string;
      startAt: string;
      originalEndAt: string;
      endAt: string;
      returnedAt: string | null;
      extensions: number;
      extensionAmount: number;
      extensionHours: number;
      lateMinutes: number;
      overdueNow: boolean;
      overdueMinutes: number;
      lateFeeCharged: number;
      lateFeeCollected: number;
      lateFeeDifference: number;
    }
  >;
  pagination: BookingPagination;
  notes: string[];
}

type Show = "all" | "extended" | "late" | "overdue" | "unpaid";

export function ExtensionsLatePage() {
  const { filters, setFilters, params } = useReportFilters();
  const [show, setShow] = useState<Show>("all");
  const [page, setPage] = usePageReset([params, show]);
  const q = useBookingReport<Data>("extensions-late-returns", params, { page, show: show === "all" ? null : show });
  const d = q.data;
  const cmp = compareLabel(d?.period.previous);
  const s = d?.summary;

  return (
    <ReportLayout
      title="Extensions & Late Returns"
      section="3.5"
      description="Extended rentals, late returns and late fees charged vs collected."
      filters={<ReportFilterBar value={filters} onChange={setFilters} rangeLabel={d?.period.label} />}
      actions={
        <ExportCsvButton
          endpoint={`${REPORTS_API}/extensions-late-returns`}
          params={show === "all" ? params : { ...params, show }}
          filename="extensions-late-returns"
        />
      }
      notes={d?.notes ?? []}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && s && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard
              testId="el-extended"
              label="Extended rentals"
              value={s.extendedBookings}
              delta={d.deltas?.extendedBookings}
              compareLabel={cmp}
              hint={`${formatNumber(s.extensions)} extensions · ${hours(s.extensionHours)} added · ${s.extendedRatePct ?? 0}% of bookings`}
            />
            <MetricCard label="Extension amount" value={s.extensionAmount} format="money" delta={d.deltas?.extensionAmount} compareLabel={cmp} />
            <MetricCard
              testId="el-late"
              label="Late returns"
              value={s.lateReturns}
              delta={d.deltas?.lateReturns}
              compareLabel={cmp}
              invert
              hint={`${s.lateRatePct ?? 0}% of ${formatNumber(s.completedBookings)} completed · avg ${minutesText(Math.round(s.avgLateMinutes ?? 0))} · ${formatNumber(s.lateReturnsNotCharged)} with no fee`}
            />
            <MetricCard label="Overdue now" value={s.overdueNow} tone={s.overdueNow > 0 ? "danger" : "default"} hint="Picked up, past the return time, not dropped" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard testId="el-charged" label="Late fees charged" value={s.lateFeeCharged} format="money" delta={d.deltas?.lateFeeCharged} compareLabel={cmp} />
            <MetricCard
              testId="el-collected"
              label="Late fees collected"
              value={s.lateFeeCollected}
              format="money"
              delta={d.deltas?.lateFeeCollected}
              compareLabel={cmp}
              hint={s.lateFeeFromDeposit > 0 ? `${formatINR(s.lateFeeFromDeposit)} of it from the deposit` : undefined}
            />
            <MetricCard
              testId="el-difference"
              label="Difference (not collected)"
              value={s.lateFeeDifference}
              format="money"
              delta={d.deltas?.lateFeeDifference}
              compareLabel={cmp}
              invert
              tone={s.lateFeeDifference > 0 ? "danger" : s.lateFeeDifference < 0 ? "warning" : "success"}
            />
          </div>

          <Section
            title="Bookings"
            actions={
              <Chooser<Show>
                value={show}
                onChange={setShow}
                testId="el-show"
                options={[
                  { value: "all", label: "All" },
                  { value: "extended", label: "Extended" },
                  { value: "late", label: "Late" },
                  { value: "unpaid", label: "Fee not collected" },
                  { value: "overdue", label: "Overdue now" },
                ]}
              />
            }
          >
            <RowTable
              testId="el-rows"
              rows={d.rows}
              rowKey={(r) => r.bookingId}
              columns={[
                { header: "Booking", cell: (r) => r.bookingId },
                { header: "Status", cell: (r) => r.statusLabel },
                { header: "Customer", cell: (r) => r.customerName },
                { header: "Vehicle", cell: (r) => r.vehicle || "Not recorded" },
                { header: "Original return", cell: (r) => istDateTime(r.originalEndAt) },
                { header: "Return", cell: (r) => istDateTime(r.endAt) },
                { header: "Returned", cell: (r) => (r.returnedAt ? istDateTime(r.returnedAt) : r.overdueNow ? <span className="text-rose-600">Overdue {minutesText(r.overdueMinutes)}</span> : "—") },
                { header: "Ext.", cell: (r) => formatNumber(r.extensions), align: "right" },
                { header: "Ext. amount", cell: (r) => moneyOr(r.extensionAmount), align: "right" },
                { header: "Late", cell: (r) => minutesText(r.lateMinutes), align: "right" },
                { header: "Fee charged", cell: (r) => moneyOr(r.lateFeeCharged), align: "right" },
                { header: "Collected", cell: (r) => moneyOr(r.lateFeeCollected), align: "right" },
                {
                  header: "Difference",
                  cell: (r) => <span className={r.lateFeeDifference > 0 ? "font-semibold text-rose-600" : ""}>{moneyOr(r.lateFeeDifference)}</span>,
                  align: "right",
                },
              ]}
            />
            <BookingPager pagination={d.pagination} onPage={setPage} />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}
