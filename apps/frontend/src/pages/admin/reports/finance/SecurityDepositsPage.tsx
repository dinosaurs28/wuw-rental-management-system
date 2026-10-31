import {
  ExportCsvButton,
  MetricCard,
  ReportFilterBar,
  ReportLayout,
  formatNumber,
  useReportFilters,
  type Delta,
} from "@/components/admin/reports/framework";
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
  rentals: number;
  taken: number;
  deducted: number;
  refunded: number;
  held: number;
  unreconciled: number;
  unreconciledRentals: number;
}
interface Row {
  bookingPublicId: string;
  startAt: string;
  status: string;
  branchName: string;
  customerName: string;
  vehicle: string;
  taken: number;
  deducted: number;
  refunded: number;
  held: number;
  unreconciled: number;
  handling: string | null;
  flow: string;
  reasonText: string;
}
interface DepositsData {
  meta: { previous: { from: string; to: string; label?: string } };
  summary: Totals;
  previous: Totals | null;
  deltas: Record<string, Delta> | null;
  heldNow: { amount: number; bookings: number };
  rows: Row[];
  pagination: Pagination;
  transactions: Array<{ publicId: string; bookingPublicId: string; paidAt: string; status: string; amount: number; mode: string; reference: string | null; collectedBy: string }>;
}

const FLOW: Record<string, string> = { DROP_BILL: "Drop bill", LEGACY: "Settlement (legacy drop)", NOT_RETURNED: "Not returned yet" };
const HANDLING: Record<string, string> = { SET_OFF: "Set off against charges", REFUND_IN_FULL: "Refunded in full" };

export function SecurityDepositsPage() {
  const { filters, setFilters, params } = useReportFilters();
  const [page, setPage] = usePage(params);
  const q = useFinanceReport<DepositsData>("deposits", params, { page, compare: 1 });
  const d = q.data;
  const cmp = compareLabel(d?.meta.previous);

  return (
    <ReportLayout
      title="Security Deposits"
      section="2.4"
      description="Refundable safety deposits taken on rentals starting in the period: deducted, refunded and still held."
      filters={<ReportFilterBar value={filters} onChange={setFilters} />}
      actions={
        <>
          <ExportCsvButton endpoint={`${FINANCE_API}/deposits`} params={params} filename="security-deposits" label="Export rentals" />
          <ExportCsvButton endpoint={`${FINANCE_API}/deposits`} params={{ ...params, table: "transactions" }} filename="deposit-transactions" label="Export deposit payments" />
        </>
      }
      notes={[
        "Rentals are those starting in the period, so the list reconciles with the period's rentals. Taken = the safety deposit put on a bill or paid on its own.",
        "Deducted = the part of the deposit used against the drop charges. On a drop bill the reasons come from the bill's charge lines, split in proportion. For legacy drops settled by the branch manager the reasons are listed without amounts (not recorded per line).",
        "Refunded = the deposit going back to the customer on the drop bill, or the deposit refunds recorded in branch settlements.",
        "Unreconciled = taken − deducted − refunded − held. It should be 0; anything else is shown, never hidden.",
        "The refundable category deposit inside a booking's total is a separate amount (see Revenue Summary).",
      ]}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard testId="dep-taken" label="Taken" value={d.summary.taken} format="money" delta={d.deltas?.taken} compareLabel={cmp} hint={`${formatNumber(d.summary.rentals)} rentals`} />
            <MetricCard testId="dep-deducted" label="Deducted" value={d.summary.deducted} format="money" delta={d.deltas?.deducted} compareLabel={cmp} />
            <MetricCard testId="dep-refunded" label="Refunded" value={d.summary.refunded} format="money" delta={d.deltas?.refunded} compareLabel={cmp} />
            <MetricCard testId="dep-held" label="Still held (these rentals)" value={d.summary.held} format="money" />
            <MetricCard testId="dep-held-now" label="Held now (all dates)" value={d.heldNow.amount} format="money" hint={`${d.heldNow.bookings} bookings`} />
            <MetricCard
              label="Unreconciled"
              value={d.summary.unreconciled}
              format="money"
              tone={d.summary.unreconciledRentals ? "danger" : "success"}
              hint={d.summary.unreconciledRentals ? `${d.summary.unreconciledRentals} rentals don't add up` : "All rentals add up"}
            />
          </div>

          <Section title="Rentals">
            <RowTable
              testId="dep-rows"
              rows={d.rows}
              rowKey={(r) => r.bookingPublicId}
              columns={[
                { header: "Booking", cell: (r) => r.bookingPublicId },
                { header: "Start", cell: (r) => istDateTime(r.startAt) },
                { header: "Customer", cell: (r) => r.customerName },
                { header: "Vehicle", cell: (r) => r.vehicle },
                { header: "Taken", cell: (r) => money(r.taken), align: "right" },
                { header: "Deducted", cell: (r) => money(r.deducted), align: "right" },
                { header: "Reason", cell: (r) => r.reasonText || "—", className: "max-w-[260px] truncate" },
                { header: "Refunded", cell: (r) => money(r.refunded), align: "right" },
                { header: "Held", cell: (r) => money(r.held), align: "right" },
                { header: "Handling", cell: (r) => (r.handling ? (HANDLING[r.handling] ?? r.handling) : FLOW[r.flow] ?? r.flow) },
                {
                  header: "Check",
                  cell: (r) => (Math.abs(r.unreconciled) >= 0.01 ? <span className="text-rose-600">{money(r.unreconciled)}</span> : "OK"),
                  align: "right",
                },
              ]}
            />
            <Pager pagination={d.pagination} onPage={setPage} />
          </Section>

          <Section title="Deposit payments in the period">
            <RowTable
              rows={d.transactions}
              rowKey={(r) => r.publicId}
              columns={[
                { header: "Paid at", cell: (r) => istDateTime(r.paidAt) },
                { header: "Booking", cell: (r) => r.bookingPublicId },
                { header: "Status", cell: (r) => r.status },
                { header: "Mode", cell: (r) => r.mode },
                { header: "Reference", cell: (r) => r.reference ?? "—" },
                { header: "Collected by", cell: (r) => r.collectedBy },
                { header: "Amount", cell: (r) => money(r.amount), align: "right" },
              ]}
            />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}

export default SecurityDepositsPage;
