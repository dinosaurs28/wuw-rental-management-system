import { useState } from "react";
import { ExportCsvButton, MetricCard, ReportFilterBar, ReportLayout, formatNumber, useReportFilters } from "@/components/admin/reports/framework";
import {
  BookingPager,
  Chooser,
  LoadState,
  REPORTS_API,
  RowTable,
  Section,
  ShareBars,
  compareLabel,
  hours,
  istDateTime,
  useBookingReport,
  usePageReset,
  type BookingBase,
  type BookingPagination,
  type Deltas,
  type PeriodInfo,
} from "./bookingsShared";

interface Dist {
  key: string;
  label: string;
  count: number;
  pct: number | null;
}
interface Group {
  id: string;
  name: string;
  bookings: number;
  avgBookedHours: number | null;
  avgActualHours: number | null;
  avgLeadHours: number | null;
  medianLeadHours: number | null;
}
interface Data {
  period: PeriodInfo;
  summary: {
    bookings: number;
    avgBookedHours: number | null;
    medianBookedHours: number | null;
    completedWithReturn: number;
    avgActualHours: number | null;
    avgLeadHours: number | null;
    medianLeadHours: number | null;
    leadDistribution: Dist[];
    periodDistribution: Dist[];
  };
  deltas: Deltas;
  byCategory: Group[];
  byBranch: Group[];
  rows: Array<
    BookingBase & {
      statusLabel: string;
      createdAt: string;
      startAt: string;
      endAt: string;
      returnedAt: string | null;
      bookedHours: number;
      actualHours: number | null;
      leadHours: number;
      leadBucketLabel: string;
      periodTypeLabel: string;
    }
  >;
  pagination: BookingPagination;
  notes: string[];
}

export function DurationLeadTimePage() {
  const { filters, setFilters, params } = useReportFilters();
  const [page, setPage] = usePageReset(params);
  const [dim, setDim] = useState<"byCategory" | "byBranch">("byCategory");
  const q = useBookingReport<Data>("duration-lead-time", params, { page });
  const d = q.data;
  const cmp = compareLabel(d?.period.previous);

  return (
    <ReportLayout
      title="Rental Duration & Lead Time"
      section="3.4"
      description="How long rentals last and how far ahead customers book."
      filters={<ReportFilterBar value={filters} onChange={setFilters} rangeLabel={d?.period.label} />}
      actions={<ExportCsvButton endpoint={`${REPORTS_API}/duration-lead-time`} params={params} filename="duration-lead-time" />}
      notes={d?.notes ?? []}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard label="Bookings" value={d.summary.bookings} delta={d.deltas?.bookings} compareLabel={cmp} />
            <MetricCard testId="dl-avg-booked" label="Avg booked duration" value={hours(d.summary.avgBookedHours)} format="text" hint={`Median ${hours(d.summary.medianBookedHours)}`} />
            <MetricCard
              testId="dl-avg-actual"
              label="Avg actual duration"
              value={hours(d.summary.avgActualHours)}
              format="text"
              hint={`${formatNumber(d.summary.completedWithReturn)} completed with a recorded return`}
            />
            <MetricCard testId="dl-avg-lead" label="Avg lead time" value={hours(d.summary.avgLeadHours)} format="text" hint={`Median ${hours(d.summary.medianLeadHours)}`} />
            <MetricCard label="Avg booked (hours)" value={d.summary.avgBookedHours} delta={d.deltas?.avgBookedHours} compareLabel={cmp} />
            <MetricCard label="Avg lead (hours)" value={d.summary.avgLeadHours} delta={d.deltas?.avgLeadHours} compareLabel={cmp} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Lead time">
              <ShareBars items={d.summary.leadDistribution} />
            </Section>
            <Section title="Rental type">
              <ShareBars items={d.summary.periodDistribution} />
            </Section>
          </div>

          <Section
            title="Breakdown"
            actions={
              <Chooser
                value={dim}
                onChange={setDim}
                options={[
                  { value: "byCategory", label: "Category" },
                  { value: "byBranch", label: "Branch" },
                ]}
              />
            }
          >
            <RowTable
              rows={d[dim]}
              rowKey={(r) => r.id}
              columns={[
                { header: dim === "byBranch" ? "Branch" : "Category", cell: (r) => r.name },
                { header: "Bookings", cell: (r) => formatNumber(r.bookings), align: "right" },
                { header: "Avg booked", cell: (r) => hours(r.avgBookedHours), align: "right" },
                { header: "Avg actual", cell: (r) => hours(r.avgActualHours), align: "right" },
                { header: "Avg lead", cell: (r) => hours(r.avgLeadHours), align: "right" },
                { header: "Median lead", cell: (r) => hours(r.medianLeadHours), align: "right" },
              ]}
            />
          </Section>

          <Section title="Bookings">
            <RowTable
              testId="dl-rows"
              rows={d.rows}
              rowKey={(r) => r.bookingId}
              columns={[
                { header: "Booking", cell: (r) => r.bookingId },
                { header: "Status", cell: (r) => r.statusLabel },
                { header: "Created", cell: (r) => istDateTime(r.createdAt) },
                { header: "Pickup", cell: (r) => istDateTime(r.startAt) },
                { header: "Lead", cell: (r) => hours(r.leadHours), align: "right" },
                { header: "Booked", cell: (r) => hours(r.bookedHours), align: "right" },
                { header: "Actual", cell: (r) => hours(r.actualHours), align: "right" },
                { header: "Type", cell: (r) => r.periodTypeLabel },
                { header: "Category", cell: (r) => r.category },
                { header: "Branch", cell: (r) => r.branchName },
              ]}
            />
            <BookingPager pagination={d.pagination} onPage={setPage} />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}
