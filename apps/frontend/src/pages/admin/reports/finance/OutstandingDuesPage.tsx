import { useState } from "react";
import {
  ExportCsvButton,
  MetricCard,
  ReportFilterBar,
  ReportLayout,
  formatNumber,
  useReportFilters,
} from "@/components/admin/reports/framework";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FINANCE_API,
  LoadState,
  Pager,
  RowTable,
  Section,
  istDate,
  istDateTime,
  money,
  useFinanceReport,
  usePage,
  type Pagination,
} from "./financeShared";

type Bucket = "0-7" | "8-30" | "31+";
interface Row {
  bookingPublicId: string;
  customerName: string;
  customerPhone: string | null;
  branchName: string;
  vehicle: string;
  status: string;
  startAt: string;
  returnedAt: string | null;
  totalOwed: number;
  netConfirmed: number;
  pendingConfirmation: number;
  due: number;
  dueFrom: string;
  dueFromBasis: "PICKUP" | "RETURN";
  ageDays: number;
  bucket: Bucket;
  lastPaymentAt: string | null;
}
interface Customer {
  customerPublicId: string;
  customerName: string;
  customerPhone: string | null;
  bookings: number;
  due: number;
  pendingConfirmation: number;
  oldestAgeDays: number;
  buckets: Record<Bucket, number>;
}
interface DuesData {
  meta: { asOf: string };
  bucketLabels: Record<Bucket, string>;
  total: number;
  customers: number;
  bookings: number;
  awaitingConfirmation: number;
  buckets: { d0_7: number; d8_30: number; d31plus: number };
  bucketCounts: { d0_7: number; d8_30: number; d31plus: number };
  notYetDue: { amount: number; bookings: number };
  byCustomer: Customer[];
  rows: Row[];
  pagination: Pagination;
}

const STATUS: Record<string, string> = { CONFIRMED: "Upcoming", PICKED_UP: "Active", RETURNED: "Completed" };

export function OutstandingDuesPage() {
  const { filters, setFilters, params } = useReportFilters();
  const [view, setView] = useState<"customers" | "bookings">("customers");
  const [page, setPage] = usePage(params);
  // Dues are a snapshot: the date range is not sent
  const { preset: _p, from: _f, to: _t, ...scope } = params;
  const q = useFinanceReport<DuesData>("dues", scope, { page });
  const d = q.data;

  return (
    <ReportLayout
      title="Outstanding Dues & Aging"
      section="2.3"
      description={d ? `Unpaid customer balances as of ${istDateTime(d.meta.asOf)}.` : "Unpaid customer balances right now."}
      filters={<ReportFilterBar value={filters} onChange={setFilters} show={{ dates: false }} />}
      actions={
        <>
          <ExportCsvButton endpoint={`${FINANCE_API}/dues`} params={{ ...scope, table: "customers" }} filename="outstanding-dues-by-customer" label="Export customers" />
          <ExportCsvButton endpoint={`${FINANCE_API}/dues`} params={scope} filename="outstanding-dues" label="Export bookings" />
        </>
      }
      notes={[
        "Due = what the booking owes (rent incl. GST and extensions, drop charges, deposit taken and not yet credited back, less goodwill) − confirmed payments net of refunds. It is the same as the booking's Amount due in the branch apps.",
        "Payments recorded but not yet confirmed by the branch manager are not counted as received; they are shown as Awaiting confirmation.",
        "Counted bookings: Active, Completed, and Upcoming ones whose start time has passed. Upcoming bookings still to start are shown as Not yet due and left out of the total.",
        "Age runs from the pickup (rent is owed at pickup). For a completed booking whose unpaid part is only drop charges, it runs from the return. Ages are IST calendar days, in buckets of 0–7, 8–30 and over 30 days.",
        "This is a snapshot, so no date range or previous-period comparison applies.",
      ]}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard testId="dues-total" label="Total outstanding" value={d.total} format="money" tone={d.total > 0 ? "warning" : "default"} hint={`${formatNumber(d.customers)} customers · ${formatNumber(d.bookings)} bookings`} />
            <MetricCard testId="dues-0-7" label={d.bucketLabels["0-7"]} value={d.buckets.d0_7} format="money" hint={`${d.bucketCounts.d0_7} bookings`} />
            <MetricCard testId="dues-8-30" label={d.bucketLabels["8-30"]} value={d.buckets.d8_30} format="money" hint={`${d.bucketCounts.d8_30} bookings`} tone={d.buckets.d8_30 > 0 ? "warning" : "default"} />
            <MetricCard testId="dues-31" label={d.bucketLabels["31+"]} value={d.buckets.d31plus} format="money" hint={`${d.bucketCounts.d31plus} bookings`} tone={d.buckets.d31plus > 0 ? "danger" : "default"} />
            <MetricCard label="Awaiting confirmation" value={d.awaitingConfirmation} format="money" hint="Recorded, not yet confirmed received" />
            <MetricCard label="Not yet due" value={d.notYetDue.amount} format="money" hint={`${d.notYetDue.bookings} upcoming bookings (not in total)`} />
          </div>

          <Section
            title={view === "customers" ? "By customer" : "By booking"}
            actions={
              <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
                <TabsList>
                  <TabsTrigger value="customers">Customers</TabsTrigger>
                  <TabsTrigger value="bookings">Bookings</TabsTrigger>
                </TabsList>
              </Tabs>
            }
          >
            {view === "customers" ? (
              <RowTable
                testId="dues-customers"
                rows={d.byCustomer}
                rowKey={(r) => r.customerPublicId}
                columns={[
                  { header: "Customer", cell: (r) => r.customerName },
                  { header: "Phone", cell: (r) => r.customerPhone ?? "Not recorded" },
                  { header: "Bookings", cell: (r) => r.bookings, align: "right" },
                  { header: "0–7 d", cell: (r) => money(r.buckets["0-7"]), align: "right" },
                  { header: "8–30 d", cell: (r) => money(r.buckets["8-30"]), align: "right" },
                  { header: "Over 30 d", cell: (r) => money(r.buckets["31+"]), align: "right" },
                  { header: "Oldest", cell: (r) => `${r.oldestAgeDays} d`, align: "right" },
                  { header: "Total due", cell: (r) => <strong>{money(r.due)}</strong>, align: "right" },
                ]}
              />
            ) : (
              <>
                <RowTable
                  testId="dues-rows"
                  rows={d.rows}
                  rowKey={(r) => r.bookingPublicId}
                  columns={[
                    { header: "Booking", cell: (r) => r.bookingPublicId },
                    { header: "Customer", cell: (r) => r.customerName },
                    { header: "Branch", cell: (r) => r.branchName },
                    { header: "Vehicle", cell: (r) => r.vehicle },
                    { header: "Status", cell: (r) => STATUS[r.status] ?? r.status },
                    { header: "Owed", cell: (r) => money(r.totalOwed), align: "right" },
                    { header: "Paid", cell: (r) => money(r.netConfirmed), align: "right" },
                    { header: "Due", cell: (r) => <strong>{money(r.due)}</strong>, align: "right" },
                    { header: "Due from", cell: (r) => `${istDate(r.dueFrom)} (${r.dueFromBasis === "RETURN" ? "return" : "pickup"})` },
                    { header: "Age", cell: (r) => `${r.ageDays} d`, align: "right" },
                    { header: "Last payment", cell: (r) => (r.lastPaymentAt ? istDate(r.lastPaymentAt) : "None") },
                  ]}
                />
                <Pager pagination={d.pagination} onPage={setPage} />
              </>
            )}
          </Section>
        </>
      )}
    </ReportLayout>
  );
}

export default OutstandingDuesPage;
