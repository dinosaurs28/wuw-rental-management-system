import { useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { ExportCsvButton, MetricCard, ReportFilterBar, ReportLayout, formatNumber, reportFilterSearch, useReportFilters } from "@/components/admin/reports/framework";
import {
  BookingPager,
  Chooser,
  LoadState,
  REPORTS_API,
  RowTable,
  Section,
  compareLabel,
  istDate,
  moneyOr,
  useBookingReport,
  usePageReset,
  type BookingPagination,
  type Deltas,
  type PeriodInfo,
} from "./bookingsShared";

interface CustomerRow {
  customerId: string;
  name: string;
  phone: string | null;
  typeLabel: string;
  bookings: number;
  revenue: number;
  avgRevenue: number | null;
  due: number;
  firstBookingAt: string | null;
  lastBookingAt: string;
}
interface Data {
  period: PeriodInfo;
  summary: {
    customers: number;
    newCustomers: number;
    repeatCustomers: number;
    repeatSharePct: number | null;
    revenue: number;
    newRevenue: number;
    repeatRevenue: number;
    avgRevenuePerCustomer: number | null;
    due: number;
  };
  deltas: Deltas;
  topCustomers: CustomerRow[];
  rows: CustomerRow[];
  pagination: BookingPagination;
  notes: string[];
}

type TypeF = "all" | "new" | "repeat";
type Sort = "revenue" | "bookings" | "due" | "name" | "recent";

export function CustomerSummaryPage() {
  const { filters, setFilters, params } = useReportFilters();
  const [type, setType] = useState<TypeF>("all");
  const [sort, setSort] = useState<Sort>("revenue");
  const [search, setSearch] = useState("");
  const [page, setPage] = usePageReset([params, type, sort, search]);
  const extra = { page, type: type === "all" ? null : type, sort, search: search.trim() || null };
  const q = useBookingReport<Data>("customer-summary", params, extra);
  const d = q.data;
  const cmp = compareLabel(d?.period.previous);
  const ltvLink = (id: string) => `/admin/reports/customer-ltv?${reportFilterSearch(filters)}&customerId=${encodeURIComponent(id)}`;

  const columns = [
    { header: "Customer", cell: (r: CustomerRow) => <Link className="text-[#FF5F00] hover:underline" to={ltvLink(r.customerId)}>{r.name}</Link> },
    { header: "Phone", cell: (r: CustomerRow) => r.phone ?? "Not recorded" },
    { header: "Type", cell: (r: CustomerRow) => r.typeLabel },
    { header: "Bookings", cell: (r: CustomerRow) => formatNumber(r.bookings), align: "right" as const },
    { header: "Revenue", cell: (r: CustomerRow) => moneyOr(r.revenue), align: "right" as const },
    { header: "Avg / booking", cell: (r: CustomerRow) => moneyOr(r.avgRevenue, "–"), align: "right" as const },
    { header: "Due now", cell: (r: CustomerRow) => moneyOr(r.due), align: "right" as const },
    { header: "First booking", cell: (r: CustomerRow) => istDate(r.firstBookingAt) },
  ];

  return (
    <ReportLayout
      title="Customer Summary"
      section="7.1"
      description="New vs repeat customers and top customers by revenue."
      filters={<ReportFilterBar value={filters} onChange={setFilters} rangeLabel={d?.period.label} />}
      actions={
        <ExportCsvButton
          endpoint={`${REPORTS_API}/customer-summary`}
          params={{ ...params, sort, ...(type === "all" ? {} : { type }), ...(search.trim() ? { search: search.trim() } : {}) }}
          filename="customer-summary"
        />
      }
      notes={d?.notes ?? []}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard testId="cs-customers" label="Customers" value={d.summary.customers} delta={d.deltas?.customers} compareLabel={cmp} />
            <MetricCard testId="cs-new" label="New" value={d.summary.newCustomers} delta={d.deltas?.newCustomers} compareLabel={cmp} />
            <MetricCard testId="cs-repeat" label="Repeat" value={d.summary.repeatCustomers} delta={d.deltas?.repeatCustomers} compareLabel={cmp} hint={`${d.summary.repeatSharePct ?? 0}% of customers`} />
            <MetricCard label="Revenue" value={d.summary.revenue} format="money" delta={d.deltas?.revenue} compareLabel={cmp} />
            <MetricCard label="Repeat revenue" value={d.summary.repeatRevenue} format="money" delta={d.deltas?.repeatRevenue} compareLabel={cmp} />
            <MetricCard label="Avg per customer" value={d.summary.avgRevenuePerCustomer} format="money" delta={d.deltas?.avgRevenuePerCustomer} compareLabel={cmp} />
          </div>

          <Section title="Top 10 customers by revenue">
            <RowTable testId="cs-top" rows={d.topCustomers} rowKey={(r) => r.customerId} columns={columns} />
          </Section>

          <Section
            title="All customers"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or phone" className="h-8 w-44" />
                <Chooser<TypeF>
                  value={type}
                  onChange={setType}
                  options={[
                    { value: "all", label: "All" },
                    { value: "new", label: "New" },
                    { value: "repeat", label: "Repeat" },
                  ]}
                />
                <Chooser<Sort>
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: "revenue", label: "Revenue" },
                    { value: "bookings", label: "Bookings" },
                    { value: "due", label: "Due" },
                    { value: "recent", label: "Recent" },
                    { value: "name", label: "Name" },
                  ]}
                />
              </div>
            }
          >
            <RowTable testId="cs-rows" rows={d.rows} rowKey={(r) => r.customerId} columns={columns} />
            <BookingPager pagination={d.pagination} onPage={setPage} />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}
