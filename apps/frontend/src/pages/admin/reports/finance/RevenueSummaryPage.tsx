import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ExportCsvButton,
  MetricCard,
  ReportFilterBar,
  ReportLayout,
  formatINR,
  formatNumber,
  useReportFilters,
  type Delta,
} from "@/components/admin/reports/framework";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FINANCE_API,
  LoadState,
  Pager,
  RowTable,
  Section,
  compareLabel,
  istDateTime,
  money,
  useFinanceReport,
  usePage,
  type Pagination,
} from "./financeShared";

interface Totals {
  total: number;
  bookingValue: number;
  rent: number;
  extras: number;
  deposit: number;
  goodwill: number;
  gst: number;
  netOfGst: number;
  bookings: number;
  averagePerBooking: number;
}
interface Group {
  key: string;
  label: string;
  revenue: number;
  rent: number;
  extras: number;
  bookings: number;
}
interface Row {
  bookingPublicId: string;
  startAt: string;
  statusLabel: string;
  branchName: string;
  customerName: string;
  vehicles: Array<{ regNo: string; name: string; categoryName: string }>;
  bookingValue: number;
  deposit: number;
  rent: number;
  extras: number;
  goodwill: number;
  revenue: number;
  gst: number;
}
interface RevenueData {
  meta: { previous: { from: string; to: string; label?: string } };
  summary: Totals;
  previous: Totals | null;
  deltas: Record<string, Delta> | null;
  trend: Array<{ key: string; label: string; revenue: number; bookings: number }>;
  byBranch: Group[];
  byCategory: Group[];
  byVehicle: Group[];
  rows: Row[];
  pagination: Pagination;
}

const GROUP_BY = ["auto", "day", "week", "month"] as const;

export function RevenueSummaryPage() {
  const { filters, setFilters, params } = useReportFilters();
  const [groupBy, setGroupBy] = useState<(typeof GROUP_BY)[number]>("auto");
  const [dim, setDim] = useState<"byBranch" | "byCategory" | "byVehicle">("byBranch");
  const [page, setPage] = usePage(params);
  const q = useFinanceReport<RevenueData>("revenue", params, { groupBy, page, compare: 1 });
  const d = q.data;
  const cmp = compareLabel(d?.meta.previous);

  return (
    <ReportLayout
      title="Revenue Summary"
      section="2.1"
      description="Revenue recognised on the rental start date, by period, branch, category and vehicle."
      filters={<ReportFilterBar value={filters} onChange={setFilters} />}
      actions={<ExportCsvButton endpoint={`${FINANCE_API}/revenue`} params={params} filename="revenue-summary" />}
      notes={[
        "Revenue = rent (GST-inclusive, after discounts, including confirmed extensions) + drop extras (drop bill net of the drop discount, legacy return charges, damage charged at drop) − goodwill refunds. It is recognised on the booking's start date for Upcoming, Active and Completed bookings. Cancelled bookings carry no revenue.",
        "Booking value is the Sales report figure (Booking total). Revenue = booking value − refundable category deposit + drop extras − goodwill refunds.",
        "GST shown is the GST inside rent and extensions. Drop charges carry no GST since 3 Oct 2026; GST on older taxable drop lines is not split out here (see the GST report).",
        "Category and vehicle use the car on the booking at report time. A swapped rental is not split between cars.",
      ]}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard testId="rev-total" label="Revenue" value={d.summary.total} format="money" delta={d.deltas?.total} compareLabel={cmp} />
            <MetricCard label="Rent" value={d.summary.rent} format="money" delta={d.deltas?.rent} compareLabel={cmp} />
            <MetricCard label="Drop extras" value={d.summary.extras} format="money" delta={d.deltas?.extras} compareLabel={cmp} />
            <MetricCard label="Bookings" value={d.summary.bookings} delta={d.deltas?.bookings} compareLabel={cmp} />
            <MetricCard label="Avg per booking" value={d.summary.averagePerBooking} format="money" delta={d.deltas?.averagePerBooking} compareLabel={cmp} />
            <MetricCard
              label="Booking value (= Sales)"
              value={d.summary.bookingValue}
              format="money"
              delta={d.deltas?.bookingValue}
              compareLabel={cmp}
              hint={`Deposit ${formatINR(d.summary.deposit)} · goodwill ${formatINR(d.summary.goodwill)} · GST ${formatINR(d.summary.gst)}`}
            />
          </div>

          <Section
            title="Trend"
            actions={
              <Tabs value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
                <TabsList>
                  {GROUP_BY.map((g) => (
                    <TabsTrigger key={g} value={g} className="capitalize">
                      {g === "auto" ? "Auto" : g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            }
          >
            <div className="h-64 rounded-xl border border-neutral-200 bg-white p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.trend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(Number(v))} width={70} />
                  <Tooltip formatter={(v: number, n: string) => (n === "revenue" ? formatINR(v) : v)} />
                  <Bar dataKey="revenue" fill="#FF5F00" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>

          <Section
            title="Breakdown"
            actions={
              <Tabs value={dim} onValueChange={(v) => setDim(v as typeof dim)}>
                <TabsList>
                  <TabsTrigger value="byBranch">Branch</TabsTrigger>
                  <TabsTrigger value="byCategory">Category</TabsTrigger>
                  <TabsTrigger value="byVehicle">Vehicle</TabsTrigger>
                </TabsList>
              </Tabs>
            }
          >
            <RowTable
              rows={d[dim]}
              rowKey={(r) => r.key}
              columns={[
                { header: dim === "byBranch" ? "Branch" : dim === "byCategory" ? "Category" : "Vehicle", cell: (r) => r.label },
                { header: "Bookings", cell: (r) => formatNumber(r.bookings), align: "right" },
                { header: "Rent", cell: (r) => money(r.rent), align: "right" },
                { header: "Drop extras", cell: (r) => money(r.extras), align: "right" },
                { header: "Revenue", cell: (r) => money(r.revenue), align: "right" },
                {
                  header: "Share",
                  cell: (r) => (d.summary.total ? `${((r.revenue / d.summary.total) * 100).toFixed(1)}%` : "–"),
                  align: "right",
                },
              ]}
            />
          </Section>

          <Section title="Bookings">
            <RowTable
              testId="rev-rows"
              rows={d.rows}
              rowKey={(r) => r.bookingPublicId}
              columns={[
                { header: "Booking", cell: (r) => r.bookingPublicId },
                { header: "Start", cell: (r) => istDateTime(r.startAt) },
                { header: "Status", cell: (r) => r.statusLabel },
                { header: "Branch", cell: (r) => r.branchName },
                { header: "Vehicle", cell: (r) => r.vehicles.map((v) => `${v.regNo} · ${v.categoryName}`).join(", ") || "Not recorded" },
                { header: "Customer", cell: (r) => r.customerName },
                { header: "Booking value", cell: (r) => money(r.bookingValue), align: "right" },
                { header: "Rent", cell: (r) => money(r.rent), align: "right" },
                { header: "Extras", cell: (r) => money(r.extras), align: "right" },
                { header: "Revenue", cell: (r) => money(r.revenue), align: "right" },
              ]}
            />
            <Pager pagination={d.pagination} onPage={setPage} />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}

export default RevenueSummaryPage;
