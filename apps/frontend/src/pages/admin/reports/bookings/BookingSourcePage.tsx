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

interface SourceRow {
  source: "APP" | "WALK_IN";
  label: string;
  bookings: number;
  cancelled: number;
  revenue: number;
  avgRevenue: number | null;
  bookingSharePct: number | null;
  revenueSharePct: number | null;
}
interface Data {
  period: PeriodInfo;
  summary: {
    totalBookings: number;
    totalRevenue: number;
    appBookings: number;
    walkInBookings: number;
    appRevenue: number;
    walkInRevenue: number;
    appSharePct: number | null;
    sources: SourceRow[];
  };
  deltas: Deltas;
  byBranch: Array<{ id: string; name: string; appBookings: number; walkInBookings: number; appRevenue: number; walkInRevenue: number }>;
  rows: Array<BookingBase & { statusLabel: string; startAt: string; createdAt: string; revenue: number }>;
  pagination: BookingPagination;
  notes: string[];
}

export function BookingSourcePage() {
  const { filters, setFilters, params } = useReportFilters();
  const [source, setSource] = useState<"all" | "APP" | "WALK_IN">("all");
  const [page, setPage] = usePageReset([params, source]);
  const q = useBookingReport<Data>("booking-source", params, { page, source: source === "all" ? null : source });
  const d = q.data;
  const cmp = compareLabel(d?.period.previous);

  return (
    <ReportLayout
      title="Booking Source"
      section="3.3"
      description="Walk-in (counter) vs app bookings — volume and revenue."
      filters={<ReportFilterBar value={filters} onChange={setFilters} rangeLabel={d?.period.label} />}
      actions={
        <ExportCsvButton endpoint={`${REPORTS_API}/booking-source`} params={source === "all" ? params : { ...params, source }} filename="booking-source" />
      }
      notes={d?.notes ?? []}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard testId="src-app" label="App bookings" value={d.summary.appBookings} delta={d.deltas?.appBookings} compareLabel={cmp} />
            <MetricCard testId="src-walkin" label="Walk-in bookings" value={d.summary.walkInBookings} delta={d.deltas?.walkInBookings} compareLabel={cmp} />
            <MetricCard label="App share" value={d.summary.appSharePct} format="percent" delta={d.deltas?.appSharePct} compareLabel={cmp} />
            <MetricCard label="App revenue" value={d.summary.appRevenue} format="money" delta={d.deltas?.appRevenue} compareLabel={cmp} />
            <MetricCard label="Walk-in revenue" value={d.summary.walkInRevenue} format="money" delta={d.deltas?.walkInRevenue} compareLabel={cmp} />
            <MetricCard label="Total revenue" value={d.summary.totalRevenue} format="money" delta={d.deltas?.totalRevenue} compareLabel={cmp} />
          </div>

          <Section title="By source">
            <RowTable
              testId="src-summary"
              rows={d.summary.sources}
              rowKey={(r) => r.source}
              columns={[
                { header: "Source", cell: (r) => r.label },
                { header: "Bookings", cell: (r) => formatNumber(r.bookings), align: "right" },
                { header: "Share", cell: (r) => (r.bookingSharePct == null ? "–" : `${r.bookingSharePct}%`), align: "right" },
                { header: "Revenue", cell: (r) => moneyOr(r.revenue), align: "right" },
                { header: "Revenue share", cell: (r) => (r.revenueSharePct == null ? "–" : `${r.revenueSharePct}%`), align: "right" },
                { header: "Avg per booking", cell: (r) => moneyOr(r.avgRevenue, "–"), align: "right" },
                { header: "Cancelled", cell: (r) => formatNumber(r.cancelled), align: "right" },
              ]}
            />
          </Section>

          <Section title="By branch">
            <RowTable
              rows={d.byBranch}
              rowKey={(r) => r.id}
              columns={[
                { header: "Branch", cell: (r) => r.name },
                { header: "App bookings", cell: (r) => formatNumber(r.appBookings), align: "right" },
                { header: "Walk-in bookings", cell: (r) => formatNumber(r.walkInBookings), align: "right" },
                { header: "App revenue", cell: (r) => moneyOr(r.appRevenue), align: "right" },
                { header: "Walk-in revenue", cell: (r) => moneyOr(r.walkInRevenue), align: "right" },
              ]}
            />
          </Section>

          <Section
            title="Bookings"
            actions={
              <Chooser
                value={source}
                onChange={setSource}
                options={[
                  { value: "all", label: "All" },
                  { value: "APP", label: "App" },
                  { value: "WALK_IN", label: "Walk-in" },
                ]}
              />
            }
          >
            <RowTable
              testId="src-rows"
              rows={d.rows}
              rowKey={(r) => r.bookingId}
              columns={[
                { header: "Booking", cell: (r) => r.bookingId },
                { header: "Source", cell: (r) => sourceLabel(r.source) },
                { header: "Created by", cell: (r) => r.createdByName ?? "Not recorded" },
                { header: "Status", cell: (r) => r.statusLabel },
                { header: "Created", cell: (r) => istDateTime(r.createdAt) },
                { header: "Pickup", cell: (r) => istDateTime(r.startAt) },
                { header: "Customer", cell: (r) => r.customerName },
                { header: "Branch", cell: (r) => r.branchName },
                { header: "Revenue", cell: (r) => moneyOr(r.revenue), align: "right" },
              ]}
            />
            <BookingPager pagination={d.pagination} onPage={setPage} />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}
