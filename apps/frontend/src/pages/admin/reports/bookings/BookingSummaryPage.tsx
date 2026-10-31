import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";
import { ExportCsvButton, MetricCard, ReportFilterBar, ReportLayout, formatNumber, useReportFilters } from "@/components/admin/reports/framework";
import {
  BookingPager,
  Chooser,
  LoadState,
  REPORTS_API,
  RowTable,
  Section,
  compareLabel,
  istDateTime,
  moneyOr,
  sourceLabel,
  useBookingReport,
  usePageReset,
  type BookingBase,
  type BookingPagination,
  type Deltas,
  type PeriodInfo,
} from "./bookingsShared";

interface StatusCounts {
  total: number;
  UPCOMING: number;
  ACTIVE: number;
  COMPLETED: number;
  CANCELLED: number;
}
interface Data {
  period: PeriodInfo;
  summary: { total: number; upcoming: number; active: number; completed: number; cancelled: number; cancellationRatePct: number | null };
  deltas: Deltas;
  byBranch: Array<StatusCounts & { id: string; name: string }>;
  byCategory: Array<StatusCounts & { id: string; name: string }>;
  trend: Array<StatusCounts & { key: string; label: string }>;
  rows: Array<BookingBase & { statusLabel: string; startAt: string; endAt: string; createdAt: string; bookingValue: number }>;
  pagination: BookingPagination;
  notes: string[];
}

export function BookingSummaryPage() {
  const { filters, setFilters, params } = useReportFilters();
  const [page, setPage] = usePageReset(params);
  const [dim, setDim] = useState<"byBranch" | "byCategory">("byBranch");
  const q = useBookingReport<Data>("booking-summary", params, { page });
  const d = q.data;
  const cmp = compareLabel(d?.period.previous);

  return (
    <ReportLayout
      title="Booking Summary"
      section="3.1"
      description="Bookings by status — upcoming, active, completed and cancelled — by branch and category."
      filters={<ReportFilterBar value={filters} onChange={setFilters} rangeLabel={d?.period.label} />}
      actions={<ExportCsvButton endpoint={`${REPORTS_API}/booking-summary`} params={params} filename="booking-summary" />}
      notes={d?.notes ?? []}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard testId="bs-total" label="Bookings" value={d.summary.total} delta={d.deltas?.total} compareLabel={cmp} />
            <MetricCard testId="bs-upcoming" label="Upcoming" value={d.summary.upcoming} delta={d.deltas?.upcoming} compareLabel={cmp} />
            <MetricCard testId="bs-active" label="Active" value={d.summary.active} delta={d.deltas?.active} compareLabel={cmp} />
            <MetricCard testId="bs-completed" label="Completed" value={d.summary.completed} delta={d.deltas?.completed} compareLabel={cmp} />
            <MetricCard testId="bs-cancelled" label="Cancelled" value={d.summary.cancelled} delta={d.deltas?.cancelled} compareLabel={cmp} invert />
            <MetricCard label="Cancellation rate" value={d.summary.cancellationRatePct} format="percent" delta={d.deltas?.cancellationRatePct} compareLabel={cmp} invert />
          </div>

          <Section title="Trend (by scheduled pickup)">
            <div className="h-64 rounded-xl border border-neutral-200 bg-white p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.trend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="UPCOMING" name="Upcoming" stackId="s" fill="#93c5fd" />
                  <Bar dataKey="ACTIVE" name="Active" stackId="s" fill="#FF5F00" />
                  <Bar dataKey="COMPLETED" name="Completed" stackId="s" fill="#16a34a" />
                  <Bar dataKey="CANCELLED" name="Cancelled" stackId="s" fill="#d4d4d4" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>

          <Section
            title="Breakdown"
            actions={
              <Chooser
                value={dim}
                onChange={setDim}
                options={[
                  { value: "byBranch", label: "Branch" },
                  { value: "byCategory", label: "Category" },
                ]}
              />
            }
          >
            <RowTable
              testId="bs-breakdown"
              rows={d[dim]}
              rowKey={(r) => r.id}
              columns={[
                { header: dim === "byBranch" ? "Branch" : "Category", cell: (r) => r.name },
                { header: "Total", cell: (r) => formatNumber(r.total), align: "right" },
                { header: "Upcoming", cell: (r) => formatNumber(r.UPCOMING), align: "right" },
                { header: "Active", cell: (r) => formatNumber(r.ACTIVE), align: "right" },
                { header: "Completed", cell: (r) => formatNumber(r.COMPLETED), align: "right" },
                { header: "Cancelled", cell: (r) => formatNumber(r.CANCELLED), align: "right" },
              ]}
            />
          </Section>

          <Section title="Bookings">
            <RowTable
              testId="bs-rows"
              rows={d.rows}
              rowKey={(r) => r.bookingId}
              columns={[
                { header: "Booking", cell: (r) => r.bookingId },
                { header: "Status", cell: (r) => r.statusLabel },
                { header: "Pickup", cell: (r) => istDateTime(r.startAt) },
                { header: "Return", cell: (r) => istDateTime(r.endAt) },
                { header: "Customer", cell: (r) => r.customerName },
                { header: "Branch", cell: (r) => r.branchName },
                { header: "Vehicle", cell: (r) => r.vehicle || "Not recorded" },
                { header: "Category", cell: (r) => r.category },
                { header: "Source", cell: (r) => sourceLabel(r.source) },
                { header: "Value", cell: (r) => moneyOr(r.bookingValue), align: "right" },
              ]}
            />
            <BookingPager pagination={d.pagination} onPage={setPage} />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}
