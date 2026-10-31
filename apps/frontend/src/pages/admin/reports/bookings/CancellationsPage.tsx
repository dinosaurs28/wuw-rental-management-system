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
  istDateTime,
  moneyOr,
  useBookingReport,
  usePageReset,
  type BookingBase,
  type BookingPagination,
  type Deltas,
  type PeriodInfo,
} from "./bookingsShared";

type CType = "NO_SHOW" | "MANUAL_BM" | "DISPLACED" | "OTHER";
interface Data {
  period: PeriodInfo;
  typeLabels: Record<CType, string>;
  summary: {
    bookings: number;
    cancellations: number;
    noShows: number;
    cancellationRatePct: number | null;
    noShowRatePct: number | null;
    missedPickups: number;
    bookedRent: number;
    rentKept: number;
    refundedOut: number;
    revenueLost: number;
    byType: Record<CType, number>;
  };
  deltas: Deltas;
  byReason: Array<{ reason: string; count: number; revenueLost: number }>;
  byBranch: Array<{ id: string; name: string; bookings: number; cancellations: number; noShows: number; revenueLost: number }>;
  rows: Array<
    BookingBase & {
      kind: "CANCELLED" | "MISSED_PICKUP";
      typeLabel: string;
      reason: string | null;
      cancelledBy: string | null;
      startAt: string;
      cancelledAt: string | null;
      bookedRent: number;
      moneyIn: number | null;
      refundedOut: number | null;
      rentKept: number | null;
      revenueLost: number | null;
    }
  >;
  pagination: BookingPagination;
  notes: string[];
}

type Filter = "all" | CType | "MISSED_PICKUP";

export function CancellationsPage() {
  const { filters, setFilters, params } = useReportFilters();
  const [type, setType] = useState<Filter>("all");
  const [page, setPage] = usePageReset([params, type]);
  const q = useBookingReport<Data>("cancellations", params, { page, type: type === "all" ? null : type });
  const d = q.data;
  const cmp = compareLabel(d?.period.previous);

  return (
    <ReportLayout
      title="Cancellations & No-Shows"
      section="3.2"
      description="Cancelled bookings and no-shows, their reasons and the estimated revenue lost."
      filters={<ReportFilterBar value={filters} onChange={setFilters} rangeLabel={d?.period.label} />}
      actions={
        <ExportCsvButton endpoint={`${REPORTS_API}/cancellations`} params={type === "all" ? params : { ...params, type }} filename="cancellations" />
      }
      notes={d?.notes ?? []}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard testId="cn-cancellations" label="Cancellations" value={d.summary.cancellations} delta={d.deltas?.cancellations} compareLabel={cmp} invert />
            <MetricCard testId="cn-noshows" label="No-shows" value={d.summary.noShows} delta={d.deltas?.noShows} compareLabel={cmp} invert />
            <MetricCard label="Cancellation rate" value={d.summary.cancellationRatePct} format="percent" delta={d.deltas?.cancellationRatePct} compareLabel={cmp} invert hint={`of ${formatNumber(d.summary.bookings)} bookings`} />
            <MetricCard label="No-show rate" value={d.summary.noShowRatePct} format="percent" delta={d.deltas?.noShowRatePct} compareLabel={cmp} invert />
            <MetricCard
              testId="cn-lost"
              label="Est. revenue lost"
              value={d.summary.revenueLost}
              format="money"
              delta={d.deltas?.revenueLost}
              compareLabel={cmp}
              invert
              tone={d.summary.revenueLost > 0 ? "warning" : "default"}
              hint={`Booked rent ${formatINR(d.summary.bookedRent)} · kept ${formatINR(d.summary.rentKept)}`}
            />
            <MetricCard
              label="Missed pickups"
              value={d.summary.missedPickups}
              hint="Confirmed, 24 h past pickup, not cancelled yet"
              tone={d.summary.missedPickups > 0 ? "warning" : "default"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="By type">
              <RowTable
                rows={(Object.keys(d.typeLabels) as CType[]).map((t) => ({ t, label: d.typeLabels[t], count: d.summary.byType[t] }))}
                rowKey={(r) => r.t}
                columns={[
                  { header: "Type", cell: (r) => r.label },
                  { header: "Count", cell: (r) => formatNumber(r.count), align: "right" },
                ]}
              />
            </Section>
            <Section title="By reason">
              <RowTable
                testId="cn-reasons"
                rows={d.byReason.slice(0, 15)}
                rowKey={(r) => r.reason}
                columns={[
                  { header: "Reason", cell: (r) => <span className="block max-w-[320px] truncate" title={r.reason}>{r.reason}</span> },
                  { header: "Count", cell: (r) => formatNumber(r.count), align: "right" },
                  { header: "Est. lost", cell: (r) => moneyOr(r.revenueLost), align: "right" },
                ]}
              />
            </Section>
          </div>

          <Section title="By branch">
            <RowTable
              rows={d.byBranch}
              rowKey={(r) => r.id}
              columns={[
                { header: "Branch", cell: (r) => r.name },
                { header: "Bookings", cell: (r) => formatNumber(r.bookings), align: "right" },
                { header: "Cancellations", cell: (r) => formatNumber(r.cancellations), align: "right" },
                { header: "No-shows", cell: (r) => formatNumber(r.noShows), align: "right" },
                { header: "Est. lost", cell: (r) => moneyOr(r.revenueLost), align: "right" },
              ]}
            />
          </Section>

          <Section
            title="Bookings"
            actions={
              <Chooser<Filter>
                value={type}
                onChange={setType}
                testId="cn-type"
                options={[
                  { value: "all", label: "All" },
                  { value: "NO_SHOW", label: "No-shows" },
                  { value: "MANUAL_BM", label: "Manager cancels" },
                  { value: "DISPLACED", label: "Displaced" },
                  { value: "OTHER", label: "Other" },
                  { value: "MISSED_PICKUP", label: "Missed pickups" },
                ]}
              />
            }
          >
            <RowTable
              testId="cn-rows"
              rows={d.rows}
              rowKey={(r) => r.bookingId}
              columns={[
                { header: "Booking", cell: (r) => r.bookingId },
                { header: "Type", cell: (r) => r.typeLabel },
                { header: "Reason", cell: (r) => <span className="block max-w-[260px] truncate" title={r.reason ?? ""}>{r.reason ?? (r.kind === "CANCELLED" ? "Not recorded" : "—")}</span> },
                { header: "Pickup", cell: (r) => istDateTime(r.startAt) },
                { header: "Cancelled", cell: (r) => istDateTime(r.cancelledAt) },
                { header: "By", cell: (r) => r.cancelledBy ?? (r.kind === "CANCELLED" ? "Not recorded" : "—") },
                { header: "Customer", cell: (r) => r.customerName },
                { header: "Branch", cell: (r) => r.branchName },
                { header: "Booked rent", cell: (r) => moneyOr(r.bookedRent), align: "right" },
                { header: "Refunded", cell: (r) => moneyOr(r.refundedOut, "—"), align: "right" },
                { header: "Kept", cell: (r) => moneyOr(r.rentKept, "—"), align: "right" },
                { header: "Est. lost", cell: (r) => moneyOr(r.revenueLost, "—"), align: "right" },
              ]}
            />
            <BookingPager pagination={d.pagination} onPage={setPage} />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}
