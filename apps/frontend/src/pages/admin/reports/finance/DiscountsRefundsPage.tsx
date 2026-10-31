import { useState } from "react";
import {
  ExportCsvButton,
  MetricCard,
  ReportFilterBar,
  ReportLayout,
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

interface DiscountTotals {
  total: number;
  gstRecorded: number;
  lines: number;
  bookings: number;
  bySource: Array<{ source: string; label: string; amount: number; lines: number }>;
}
interface RefundTotals {
  paidOut: number;
  count: number;
  goodwill: number;
  cancellation: number;
  voided: number;
  byKind: Array<{ kind: string; label: string; amount: number; count: number }>;
}
interface DiscountLine {
  bookingPublicId: string;
  startAt: string;
  branchName: string;
  customerName: string;
  sourceLabel: string;
  amount: number;
  gst: number | null;
  code: string | null;
  appliedBy: string;
  approvedBy: string | null;
  reason: string | null;
}
interface RefundRow {
  publicId: string;
  paidAt: string;
  bookingPublicId: string;
  customerName: string;
  kindLabel: string;
  status: string;
  counted: boolean;
  amount: number;
  goodwill: number;
  mode: string;
  reference: string | null;
  proof: boolean;
  paidBy: string;
  reason: string | null;
}
interface Data {
  meta: { previous: { from: string; to: string; label?: string } };
  discounts: DiscountTotals;
  refunds: RefundTotals;
  deltas: Record<string, Delta> | null;
  discountLines: DiscountLine[];
  discountPagination: Pagination;
  refundRows: RefundRow[];
  refundPagination: Pagination;
  refundRequests: Array<{ publicId: string; bookingPublicId: string; amount: number; reason: string; status: string; requestedAt: string; requestedBy: string; approvedBy: string | null; completedBy: string | null; rejectionReason: string | null }>;
  gatewayRefunds: Array<{ publicId: string; bookingPublicId: string; purpose: string; amount: number; paidAt: string }>;
}

export function DiscountsRefundsPage() {
  const { filters, setFilters, params } = useReportFilters();
  const [tab, setTab] = useState<"discounts" | "refunds">("discounts");
  const [page, setPage] = usePage(params);
  const q = useFinanceReport<Data>("discounts-refunds", params, { page, compare: 1 });
  const d = q.data;
  const cmp = compareLabel(d?.meta.previous);

  return (
    <ReportLayout
      title="Discounts & Refunds"
      section="2.5"
      description="Discounts given on rentals in the period (who and why) and money refunded to customers."
      filters={<ReportFilterBar value={filters} onChange={setFilters} />}
      actions={
        <>
          <ExportCsvButton endpoint={`${FINANCE_API}/discounts-refunds`} params={params} filename="discounts" label="Export discounts" />
          <ExportCsvButton endpoint={`${FINANCE_API}/discounts-refunds`} params={{ ...params, table: "refunds" }} filename="refunds" label="Export refunds" />
        </>
      }
      notes={[
        "Discounts belong to rentals starting in the period (same as revenue). Amounts are taken off the rent without GST, the basis of the booking's discount total. The GST also taken off is shown where it was recorded (counter coupon, pickup and drop discounts).",
        "Who applied: manual discounts have issuer and approver; counter coupons, pickup and drop discounts have the staff member who applied them; booking coupons and duration slabs show the booking's creator ('Customer (online)' for app bookings). Extension discounts don't record who applied them.",
        "'Booking discount (source not recorded)' is discount on the booking that the discount breakdown doesn't explain (e.g. older bookings or repricing).",
        "Refunds are money paid back by payment date. Voided refunds are listed but not counted. 'Goodwill' is the part of a Refund to customer beyond what the booking owed back.",
        "Razorpay refunds are detected only: the payment row is marked Refunded, and the refund date isn't recorded, so they are listed by payment date and not added to refunds paid out.",
      ]}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard testId="disc-total" label="Discounts given" value={d.discounts.total} format="money" delta={d.deltas?.discounts} compareLabel={cmp} invert hint={`${formatNumber(d.discounts.bookings)} bookings`} />
            <MetricCard label="GST taken off (recorded)" value={d.discounts.gstRecorded} format="money" />
            <MetricCard testId="ref-total" label="Refunds paid out" value={d.refunds.paidOut} format="money" delta={d.deltas?.refunds} compareLabel={cmp} invert hint={`${d.refunds.count} refunds`} />
            <MetricCard label="Cancellation refunds" value={d.refunds.cancellation} format="money" delta={d.deltas?.cancellationRefunds} compareLabel={cmp} invert />
            <MetricCard label="Goodwill part" value={d.refunds.goodwill} format="money" />
            <MetricCard label="Voided refunds" value={d.refunds.voided} format="money" hint="Not counted" />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <RowTable
              rows={d.discounts.bySource}
              rowKey={(r) => r.source}
              columns={[
                { header: "Discount type", cell: (r) => r.label },
                { header: "Lines", cell: (r) => r.lines, align: "right" },
                { header: "Amount", cell: (r) => money(r.amount), align: "right" },
              ]}
            />
            <RowTable
              rows={d.refunds.byKind}
              rowKey={(r) => r.kind}
              columns={[
                { header: "Refund type", cell: (r) => r.label },
                { header: "Count", cell: (r) => r.count, align: "right" },
                { header: "Amount", cell: (r) => money(r.amount), align: "right" },
              ]}
            />
          </div>

          <Section
            title={tab === "discounts" ? "Discount lines" : "Refunds"}
            actions={
              <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
                <TabsList>
                  <TabsTrigger value="discounts">Discounts</TabsTrigger>
                  <TabsTrigger value="refunds">Refunds</TabsTrigger>
                </TabsList>
              </Tabs>
            }
          >
            {tab === "discounts" ? (
              <>
                <RowTable
                  testId="disc-rows"
                  rows={d.discountLines}
                  rowKey={(r, i) => `${r.bookingPublicId}-${i}`}
                  columns={[
                    { header: "Booking", cell: (r) => r.bookingPublicId },
                    { header: "Start", cell: (r) => istDateTime(r.startAt) },
                    { header: "Customer", cell: (r) => r.customerName },
                    { header: "Type", cell: (r) => r.sourceLabel },
                    { header: "Code", cell: (r) => r.code ?? "—" },
                    { header: "Applied by", cell: (r) => r.appliedBy },
                    { header: "Approved by", cell: (r) => r.approvedBy ?? "—" },
                    { header: "Reason", cell: (r) => r.reason ?? "Not recorded", className: "max-w-[240px] truncate" },
                    { header: "Amount", cell: (r) => money(r.amount), align: "right" },
                    { header: "GST off", cell: (r) => (r.gst == null ? "—" : money(r.gst)), align: "right" },
                  ]}
                />
                <Pager pagination={d.discountPagination} onPage={setPage} />
              </>
            ) : (
              <>
                <RowTable
                  testId="ref-rows"
                  rows={d.refundRows}
                  rowKey={(r) => r.publicId}
                  columns={[
                    { header: "Paid at", cell: (r) => istDateTime(r.paidAt) },
                    { header: "Booking", cell: (r) => r.bookingPublicId },
                    { header: "Customer", cell: (r) => r.customerName },
                    { header: "Type", cell: (r) => r.kindLabel },
                    { header: "Status", cell: (r) => <span className={r.counted ? "" : "text-neutral-400 line-through"}>{r.status}</span> },
                    { header: "Mode", cell: (r) => r.mode },
                    { header: "Proof", cell: (r) => (r.proof ? "Yes" : "No") },
                    { header: "Paid by", cell: (r) => r.paidBy },
                    { header: "Reason / note", cell: (r) => r.reason ?? "Not recorded", className: "max-w-[240px] truncate" },
                    { header: "Amount", cell: (r) => money(r.amount), align: "right" },
                  ]}
                />
                <Pager pagination={d.refundPagination} onPage={setPage} />
                {d.refundRequests.length > 0 && (
                  <Section title="Refund requests raised in the period">
                    <RowTable
                      rows={d.refundRequests}
                      rowKey={(r) => r.publicId}
                      columns={[
                        { header: "Requested", cell: (r) => istDateTime(r.requestedAt) },
                        { header: "Booking", cell: (r) => r.bookingPublicId },
                        { header: "Status", cell: (r) => r.status },
                        { header: "Requested by", cell: (r) => r.requestedBy },
                        { header: "Approved by", cell: (r) => r.approvedBy ?? "—" },
                        { header: "Reason", cell: (r) => r.reason, className: "max-w-[260px] truncate" },
                        { header: "Amount", cell: (r) => money(r.amount), align: "right" },
                      ]}
                    />
                  </Section>
                )}
                {d.gatewayRefunds.length > 0 && (
                  <Section title="Razorpay payments marked refunded (detect-only)">
                    <RowTable
                      rows={d.gatewayRefunds}
                      rowKey={(r) => r.publicId}
                      columns={[
                        { header: "Paid at", cell: (r) => istDateTime(r.paidAt) },
                        { header: "Booking", cell: (r) => r.bookingPublicId },
                        { header: "Payment", cell: (r) => r.publicId },
                        { header: "Amount", cell: (r) => money(r.amount), align: "right" },
                      ]}
                    />
                  </Section>
                )}
              </>
            )}
          </Section>
        </>
      )}
    </ReportLayout>
  );
}

export default DiscountsRefundsPage;
