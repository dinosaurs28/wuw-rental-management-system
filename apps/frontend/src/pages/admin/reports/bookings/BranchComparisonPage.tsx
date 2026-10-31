import { Link } from "react-router-dom";
import {
  ComparisonBadge,
  ExportCsvButton,
  MetricCard,
  ReportFilterBar,
  ReportLayout,
  formatNumber,
  formatPct,
  useReportFilters,
  type Delta,
} from "@/components/admin/reports/framework";
import { LoadState, REPORTS_API, RowTable, Section, compareLabel, moneyOr, useBookingReport, type Deltas, type PeriodInfo } from "./bookingsShared";

interface Figures {
  bookings: number;
  cancellations: number;
  revenue: number;
  avgRevenuePerBooking: number | null;
  collected: number;
  due: number;
  utilizationPct: number | null;
  rentedDays: number;
  availableDays: number;
  vehicles: number;
}
interface Data {
  period: PeriodInfo;
  branchCount: number;
  singleBranch: boolean;
  summary: Figures;
  deltas: Deltas;
  rows: Array<Figures & { branchId: string; branchName: string; deltas: Record<string, Delta> | null }>;
  notes: string[];
}

export function BranchComparisonPage() {
  const { filters, setFilters, params } = useReportFilters();
  const q = useBookingReport<Data>("branch-comparison", params);
  const d = q.data;
  const cmp = compareLabel(d?.period.previous);
  const withDelta = (v: string, delta: Delta | undefined, format: "money" | "number" | "percent" = "number", invert = false) => (
    <div className="flex flex-col items-end">
      <span>{v}</span>
      {delta && <ComparisonBadge delta={delta} format={format} invert={invert} />}
    </div>
  );

  return (
    <ReportLayout
      title="Branch Comparison"
      section="8.1"
      description="Revenue, utilization and outstanding dues per branch, for the same period."
      filters={<ReportFilterBar value={filters} onChange={setFilters} show={{ branch: false }} rangeLabel={d?.period.label} />}
      actions={<ExportCsvButton endpoint={`${REPORTS_API}/branch-comparison`} params={{ ...params, compare: "1" }} filename="branch-comparison" />}
      notes={d?.notes ?? []}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard testId="bc-revenue" label="Revenue" value={d.summary.revenue} format="money" delta={d.deltas?.revenue} compareLabel={cmp} />
            <MetricCard label="Bookings" value={d.summary.bookings} delta={d.deltas?.bookings} compareLabel={cmp} />
            <MetricCard label="Collected" value={d.summary.collected} format="money" delta={d.deltas?.collected} compareLabel={cmp} />
            <MetricCard testId="bc-due" label="Outstanding dues" value={d.summary.due} format="money" invert tone={d.summary.due > 0 ? "warning" : "default"} />
            <MetricCard label="Utilization" value={d.summary.utilizationPct} format="percent" delta={d.deltas?.utilizationPct} compareLabel={cmp} to="/admin/reports/fleet/utilization" />
            <MetricCard label="Cancellations" value={d.summary.cancellations} delta={d.deltas?.cancellations} compareLabel={cmp} invert />
          </div>

          {d.singleBranch ? (
            <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600" data-testid="bc-single">
              Only one branch is set up ({d.rows[0]?.branchName ?? "—"}), so there is nothing to compare. The cards above are that branch's figures.
            </div>
          ) : (
            <Section title={`Branches (${d.branchCount})`}>
              <RowTable
                testId="bc-rows"
                rows={d.rows}
                rowKey={(r) => r.branchId}
                columns={[
                  {
                    header: "Branch",
                    cell: (r) => (
                      <Link className="text-[#FF5F00] hover:underline" to={`/admin/reports/booking-summary?${new URLSearchParams({ ...params, branchId: r.branchId }).toString()}`}>
                        {r.branchName}
                      </Link>
                    ),
                  },
                  { header: "Bookings", cell: (r) => withDelta(formatNumber(r.bookings), r.deltas?.bookings), align: "right" },
                  { header: "Revenue", cell: (r) => withDelta(moneyOr(r.revenue), r.deltas?.revenue, "money"), align: "right" },
                  { header: "Avg / booking", cell: (r) => moneyOr(r.avgRevenuePerBooking, "–"), align: "right" },
                  { header: "Collected", cell: (r) => withDelta(moneyOr(r.collected), r.deltas?.collected, "money"), align: "right" },
                  { header: "Outstanding", cell: (r) => moneyOr(r.due), align: "right" },
                  {
                    header: "Utilization",
                    cell: (r) => withDelta(r.utilizationPct == null ? "No vehicles" : formatPct(r.utilizationPct), r.deltas?.utilizationPct, "percent"),
                    align: "right",
                  },
                  { header: "Vehicles", cell: (r) => formatNumber(r.vehicles), align: "right" },
                  { header: "Cancelled", cell: (r) => withDelta(formatNumber(r.cancellations), r.deltas?.cancellations, "number", true), align: "right" },
                ]}
              />
            </Section>
          )}
        </>
      )}
    </ReportLayout>
  );
}
