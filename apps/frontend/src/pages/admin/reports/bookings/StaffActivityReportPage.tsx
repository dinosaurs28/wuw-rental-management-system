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
  useBookingReport,
  usePageReset,
  type BookingPagination,
  type Deltas,
  type PeriodInfo,
} from "./bookingsShared";

type Kind = "BOOKING_CREATED" | "PAYMENT_COLLECTED" | "REFUND_PAID" | "PICKUP" | "DROP";
interface StaffRow {
  staffId: string;
  staffName: string;
  staffRole: string;
  bookingsCreated: number;
  bookingValue: number;
  paymentsCollected: number;
  amountCollected: number;
  cashCollected: number;
  onlineCollected: number;
  refundsPaid: number;
  refundAmount: number;
  pickups: number;
  drops: number;
  handovers: number;
}
interface Data {
  period: PeriodInfo;
  activityLabels: Record<Kind, string>;
  summary: {
    staff: number;
    bookingsCreated: number;
    paymentsCollected: number;
    amountCollected: number;
    cashCollected: number;
    pickups: number;
    drops: number;
    handovers: number;
    unattributedHandovers: number;
  };
  deltas: Deltas;
  staff: StaffRow[];
  transactions: Array<{
    kind: Kind;
    kindLabel: string;
    at: string;
    staffId: string;
    staffName: string;
    branchName: string;
    bookingId: string;
    customerName: string;
    amount: number | null;
    cash: number | null;
    online: number | null;
    detail: string | null;
  }>;
  staffOptions: Array<{ publicId: string; name: string; role: string; isActive: boolean }>;
  pagination: BookingPagination;
  notes: string[];
}

export function StaffActivityReportPage() {
  const { filters, setFilters, params } = useReportFilters();
  const [staffId, setStaffId] = useState("all");
  const [kind, setKind] = useState<"all" | Kind>("all");
  const [page, setPage] = usePageReset([params, staffId, kind]);
  const extra = { page, staffId: staffId === "all" ? null : staffId, kind: kind === "all" ? null : kind };
  const q = useBookingReport<Data>("staff-activity", params, extra);
  const d = q.data;
  const cmp = compareLabel(d?.period.previous);
  const exportParams: Record<string, string> = { ...params, ...(staffId !== "all" ? { staffId } : {}), ...(kind !== "all" ? { kind } : {}) };

  return (
    <ReportLayout
      title="Staff Activity"
      section="8.2"
      description="Bookings handled, payments and cash collected, and handovers completed per staff member."
      filters={<ReportFilterBar value={filters} onChange={setFilters} rangeLabel={d?.period.label} />}
      actions={
        <div className="flex flex-wrap gap-2">
          <ExportCsvButton endpoint={`${REPORTS_API}/staff-activity`} params={exportParams} filename="staff-activity" label="Export per staff" />
          <ExportCsvButton
            endpoint={`${REPORTS_API}/staff-activity`}
            params={{ ...exportParams, view: "transactions" }}
            filename="staff-activity-transactions"
            label="Export transactions"
          />
        </div>
      }
      notes={d?.notes ?? []}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-neutral-600">Staff</span>
            <select
              className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-sm"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              data-testid="sa-staff"
            >
              <option value="all">Everyone</option>
              {d.staffOptions.map((s) => (
                <option key={s.publicId} value={s.publicId}>
                  {s.name} ({s.role.toLowerCase()}){s.isActive ? "" : " — inactive"}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard testId="sa-bookings" label="Bookings handled" value={d.summary.bookingsCreated} delta={d.deltas?.bookingsCreated} compareLabel={cmp} />
            <MetricCard testId="sa-payments" label="Payments collected" value={d.summary.paymentsCollected} delta={d.deltas?.paymentsCollected} compareLabel={cmp} />
            <MetricCard testId="sa-amount" label="Amount collected" value={d.summary.amountCollected} format="money" delta={d.deltas?.amountCollected} compareLabel={cmp} />
            <MetricCard testId="sa-cash" label="Cash collected" value={d.summary.cashCollected} format="money" delta={d.deltas?.cashCollected} compareLabel={cmp} />
            <MetricCard
              testId="sa-handovers"
              label="Handovers"
              value={d.summary.handovers}
              delta={d.deltas?.handovers}
              compareLabel={cmp}
              hint={`${formatNumber(d.summary.pickups)} pickups · ${formatNumber(d.summary.drops)} drops`}
            />
            <MetricCard
              label="Handovers not attributed"
              value={d.summary.unattributedHandovers}
              hint="No recorded performer (older rows)"
              tone={d.summary.unattributedHandovers > 0 ? "warning" : "default"}
            />
          </div>

          <Section title="Per staff member">
            <RowTable
              testId="sa-staff-rows"
              rows={d.staff}
              rowKey={(r) => r.staffId}
              columns={[
                { header: "Staff", cell: (r) => r.staffName },
                { header: "Role", cell: (r) => r.staffRole.toLowerCase() },
                { header: "Bookings", cell: (r) => formatNumber(r.bookingsCreated), align: "right" },
                { header: "Payments", cell: (r) => formatNumber(r.paymentsCollected), align: "right" },
                { header: "Collected", cell: (r) => moneyOr(r.amountCollected), align: "right" },
                { header: "Cash", cell: (r) => moneyOr(r.cashCollected), align: "right" },
                { header: "Online / UPI", cell: (r) => moneyOr(r.onlineCollected), align: "right" },
                { header: "Refunds paid", cell: (r) => (r.refundsPaid ? `${formatNumber(r.refundsPaid)} · ${moneyOr(r.refundAmount)}` : "—"), align: "right" },
                { header: "Pickups", cell: (r) => formatNumber(r.pickups), align: "right" },
                { header: "Drops", cell: (r) => formatNumber(r.drops), align: "right" },
              ]}
            />
          </Section>

          <Section
            title="Transactions"
            actions={
              <Chooser<"all" | Kind>
                value={kind}
                onChange={setKind}
                testId="sa-kind"
                options={[
                  { value: "all", label: "All" },
                  { value: "BOOKING_CREATED", label: "Bookings" },
                  { value: "PAYMENT_COLLECTED", label: "Payments" },
                  { value: "REFUND_PAID", label: "Refunds" },
                  { value: "PICKUP", label: "Pickups" },
                  { value: "DROP", label: "Drops" },
                ]}
              />
            }
          >
            <RowTable
              testId="sa-txn-rows"
              rows={d.transactions}
              rowKey={(r, i) => `${r.kind}-${r.bookingId}-${r.at}-${i}`}
              columns={[
                { header: "When", cell: (r) => istDateTime(r.at) },
                { header: "Staff", cell: (r) => r.staffName },
                { header: "Activity", cell: (r) => r.kindLabel },
                { header: "Booking", cell: (r) => r.bookingId },
                { header: "Customer", cell: (r) => r.customerName },
                { header: "Branch", cell: (r) => r.branchName },
                { header: "Amount", cell: (r) => moneyOr(r.amount, "—"), align: "right" },
                { header: "Cash", cell: (r) => moneyOr(r.cash, "—"), align: "right" },
                { header: "Detail", cell: (r) => r.detail ?? "" },
              ]}
            />
            <BookingPager pagination={d.pagination} onPage={setPage} />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}
