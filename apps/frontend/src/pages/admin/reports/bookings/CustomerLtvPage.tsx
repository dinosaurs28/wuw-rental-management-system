import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ExportCsvButton, MetricCard, ReportFilterBar, ReportLayout, formatNumber, useReportFilters } from "@/components/admin/reports/framework";
import {
  BookingPager,
  Chooser,
  LoadState,
  REPORTS_API,
  RowTable,
  Section,
  istDate,
  istDateTime,
  moneyOr,
  useBookingReport,
  usePageReset,
  type BookingBase,
  type BookingPagination,
  type PeriodInfo,
} from "./bookingsShared";

interface LtvRow {
  customerId: string;
  name: string;
  phone: string | null;
  trips: number;
  bookings: number;
  cancellations: number;
  revenue: number;
  paid: number;
  due: number;
  avgRevenuePerTrip: number | null;
  firstBookingAt: string | null;
  lastBookingAt: string | null;
}
interface ListData {
  period: PeriodInfo;
  summary: { customers: number; trips: number; lifetimeRevenue: number; paid: number; due: number; customersWithDue: number; avgLifetimeValue: number | null };
  rows: LtvRow[];
  pagination: BookingPagination;
  notes: string[];
}
interface HistoryData {
  customer: { customerId: string; name: string; phone: string | null; registeredAt: string; isBlacklisted: boolean };
  summary: { bookings: number; trips: number; cancellations: number; revenue: number; paid: number; due: number };
  rows: Array<
    BookingBase & {
      statusLabel: string;
      startAt: string;
      endAt: string;
      returnedAt: string | null;
      cancelledAt: string | null;
      extensions: number;
      revenue: number;
      paid: number;
      due: number;
    }
  >;
}

type Sort = "revenue" | "bookings" | "due" | "name" | "recent";

export function CustomerLtvPage() {
  const { filters, setFilters, params } = useReportFilters();
  const [search, setSearchParams] = useSearchParams();
  const customerId = search.get("customerId");
  const [scope, setScope] = useState<"range" | "all">("range");
  const [sort, setSort] = useState<Sort>("revenue");
  const [text, setText] = useState("");
  const [page, setPage] = usePageReset([params, scope, sort, text]);

  const list = useBookingReport<ListData>("customer-ltv", params, {
    page,
    sort,
    allTime: scope === "all" ? 1 : null,
    search: text.trim() || null,
  }, !customerId);
  const history = useBookingReport<HistoryData>("customer-ltv", params, { customerId }, !!customerId);
  const open = (id: string | null) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("customerId", id);
      else next.delete("customerId");
      return next;
    });

  if (customerId) {
    const h = history.data;
    return (
      <ReportLayout
        title={h ? `Customer history — ${h.customer.name}` : "Customer history"}
        section="7.2"
        description="Every booking of this customer (within the branch / category / vehicle filters), with spend and dues."
        filters={<ReportFilterBar value={filters} onChange={setFilters} show={{ dates: false }} />}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" className="h-9" onClick={() => open(null)}>
              Back to all customers
            </Button>
            <ExportCsvButton endpoint={`${REPORTS_API}/customer-ltv`} params={{ ...params, customerId }} filename={`customer-history-${customerId}`} />
          </div>
        }
      >
        <LoadState isLoading={history.isLoading} error={history.error} />
        {h && (
          <>
            <p className="mb-3 text-sm text-neutral-600">
              {h.customer.phone ?? "Phone not recorded"} · registered {istDate(h.customer.registeredAt)}
              {h.customer.isBlacklisted && <span className="ml-2 rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-700">Blacklisted</span>}
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <MetricCard testId="ch-trips" label="Trips (completed)" value={h.summary.trips} />
              <MetricCard label="Bookings" value={h.summary.bookings} />
              <MetricCard label="Cancellations" value={h.summary.cancellations} />
              <MetricCard testId="ch-spend" label="Total spend" value={h.summary.revenue} format="money" />
              <MetricCard label="Paid" value={h.summary.paid} format="money" />
              <MetricCard testId="ch-due" label="Outstanding" value={h.summary.due} format="money" tone={h.summary.due > 0 ? "danger" : "default"} />
            </div>
            <Section title="Bookings">
              <RowTable
                testId="ch-rows"
                rows={h.rows}
                rowKey={(r) => r.bookingId}
                columns={[
                  { header: "Booking", cell: (r) => r.bookingId },
                  { header: "Status", cell: (r) => r.statusLabel },
                  { header: "Pickup", cell: (r) => istDateTime(r.startAt) },
                  { header: "Returned", cell: (r) => istDateTime(r.returnedAt ?? r.cancelledAt) },
                  { header: "Vehicle", cell: (r) => r.vehicle || "Not recorded" },
                  { header: "Branch", cell: (r) => r.branchName },
                  { header: "Ext.", cell: (r) => formatNumber(r.extensions), align: "right" },
                  { header: "Spend", cell: (r) => moneyOr(r.revenue), align: "right" },
                  { header: "Paid", cell: (r) => moneyOr(r.paid), align: "right" },
                  { header: "Due", cell: (r) => moneyOr(r.due), align: "right" },
                ]}
              />
            </Section>
          </>
        )}
      </ReportLayout>
    );
  }

  const d = list.data;
  return (
    <ReportLayout
      title="Customer History & Lifetime Value"
      section="7.2"
      description="Trips, total spend and outstanding dues per customer, over their whole history."
      filters={<ReportFilterBar value={filters} onChange={setFilters} rangeLabel={d?.period.label} />}
      actions={
        <ExportCsvButton
          endpoint={`${REPORTS_API}/customer-ltv`}
          params={{ ...params, sort, ...(scope === "all" ? { allTime: "1" } : {}), ...(text.trim() ? { search: text.trim() } : {}) }}
          filename="customer-ltv"
        />
      }
      notes={d?.notes ?? []}
    >
      <LoadState isLoading={list.isLoading} error={list.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard testId="ltv-customers" label="Customers" value={d.summary.customers} />
            <MetricCard label="Trips" value={d.summary.trips} />
            <MetricCard testId="ltv-revenue" label="Lifetime spend" value={d.summary.lifetimeRevenue} format="money" />
            <MetricCard label="Avg lifetime value" value={d.summary.avgLifetimeValue} format="money" />
            <MetricCard label="Paid" value={d.summary.paid} format="money" />
            <MetricCard
              testId="ltv-due"
              label="Outstanding"
              value={d.summary.due}
              format="money"
              tone={d.summary.due > 0 ? "danger" : "default"}
              hint={`${formatNumber(d.summary.customersWithDue)} customers owe`}
            />
          </div>
          <Section
            title="Customers"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Name or phone" className="h-8 w-44" />
                <Chooser
                  value={scope}
                  onChange={setScope}
                  testId="ltv-scope"
                  options={[
                    { value: "range", label: "Booked in range" },
                    { value: "all", label: "All customers" },
                  ]}
                />
                <Chooser<Sort>
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: "revenue", label: "Spend" },
                    { value: "bookings", label: "Bookings" },
                    { value: "due", label: "Due" },
                    { value: "recent", label: "Recent" },
                    { value: "name", label: "Name" },
                  ]}
                />
              </div>
            }
          >
            <RowTable
              testId="ltv-rows"
              rows={d.rows}
              rowKey={(r) => r.customerId}
              columns={[
                {
                  header: "Customer",
                  cell: (r) => (
                    <button type="button" className="text-[#FF5F00] hover:underline" onClick={() => open(r.customerId)}>
                      {r.name}
                    </button>
                  ),
                },
                { header: "Phone", cell: (r) => r.phone ?? "Not recorded" },
                { header: "Trips", cell: (r) => formatNumber(r.trips), align: "right" },
                { header: "Bookings", cell: (r) => formatNumber(r.bookings), align: "right" },
                { header: "Cancelled", cell: (r) => formatNumber(r.cancellations), align: "right" },
                { header: "Total spend", cell: (r) => moneyOr(r.revenue), align: "right" },
                { header: "Paid", cell: (r) => moneyOr(r.paid), align: "right" },
                { header: "Outstanding", cell: (r) => moneyOr(r.due), align: "right" },
                { header: "Avg / trip", cell: (r) => moneyOr(r.avgRevenuePerTrip, "–"), align: "right" },
                { header: "First", cell: (r) => istDate(r.firstBookingAt) },
                { header: "Last", cell: (r) => istDate(r.lastBookingAt) },
              ]}
            />
            <BookingPager pagination={d.pagination} onPage={setPage} />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}
