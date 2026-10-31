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

type Modes = { CASH: number; UPI: number; BANK_TRANSFER: number; GATEWAY: number };
interface Totals {
  collected: number;
  confirmed: number;
  awaitingConfirmation: number;
  rentalCollections: number;
  securityDeposits: number;
  refundsPaidOut: number;
  net: number;
  transactions: number;
  modes: Modes;
  refundModes: Modes;
}
interface Txn {
  publicId: string;
  bookingPublicId: string;
  purpose: string;
  amount: number;
  paidAt: string;
  collectedBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
}
interface Shift {
  publicId: string;
  branchName: string;
  employee: string;
  closedBy: string | null;
  closedAt: string;
  expected: number;
  counted: number;
  difference: number;
  explanation: string | null;
}
interface Row {
  publicId: string;
  paidAt: string;
  bookingPublicId: string;
  customerName: string;
  purposeLabel: string;
  direction: "IN" | "OUT";
  status: string;
  counted: boolean;
  amount: number;
  modeLabel: string;
  reference: string | null;
  collectedBy: string;
  confirmedBy: string | null;
  shift: string | null;
}
interface CollectionsData {
  meta: { previous: { from: string; to: string; label?: string } };
  modeLabels: Record<keyof Modes, string>;
  notTracked: { card: string };
  summary: Totals;
  previous: Totals | null;
  deltas: Record<string, Delta> | null;
  byStaff: Array<{ staff: string; transactions: number; collected: number; cash: number; online: number; awaitingConfirmation: number }>;
  byPurpose: Array<{ purpose: string; label: string; direction: string; transactions: number; amount: number }>;
  discrepancies: {
    awaitingConfirmation: { count: number; amount: number; rows: Txn[] };
    voided: { count: number; amount: number; rows: Txn[] };
    rejected: { count: number; amount: number; rows: Txn[] };
    cashShifts: { closed: number; withDifference: number; short: number; over: number; rows: Shift[] };
  };
  rows: Row[];
  pagination: Pagination;
}

const MODE_ORDER: Array<keyof Modes> = ["CASH", "UPI", "BANK_TRANSFER", "GATEWAY"];
const DELTA_KEY: Record<keyof Modes, string> = { CASH: "cash", UPI: "upi", BANK_TRANSFER: "bankTransfer", GATEWAY: "gateway" };

export function PaymentsCollectionsPage() {
  const { filters, setFilters, params } = useReportFilters();
  const [page, setPage] = usePage(params);
  const q = useFinanceReport<CollectionsData>("collections", params, { page, compare: 1 });
  const d = q.data;
  const cmp = compareLabel(d?.meta.previous);

  return (
    <ReportLayout
      title="Payments & Collections"
      section="2.2"
      description="Money received by payment date, by mode and staff, with every transaction for reconciliation."
      filters={<ReportFilterBar value={filters} onChange={setFilters} />}
      actions={
        <>
          <ExportCsvButton endpoint={`${FINANCE_API}/collections`} params={params} filename="payments-collections" label="Export transactions" />
          <ExportCsvButton endpoint={`${FINANCE_API}/collections`} params={{ ...params, table: "shifts" }} filename="cash-shifts" label="Export cash shifts" />
        </>
      }
      notes={[
        "Collected = payments with status Collected (awaiting the branch manager's confirmation) or Confirmed, by payment time (collected time, else created time). Voided and rejected entries count nowhere and are listed under discrepancies.",
        "Rental collections exclude security deposits (held money). Net = collected − refunds paid out.",
        "Mode: cash and online parts come from each payment. Online is UPI unless it was recorded as a bank transfer or went through the Razorpay gateway.",
        d?.notTracked.card ?? "",
        "Staff is the person who recorded the payment. Payments the customer made online have no collector.",
        "Cash shifts have no category or vehicle, so only the branch filter applies to them.",
      ].filter(Boolean)}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard testId="col-collected" label="Collected" value={d.summary.collected} format="money" delta={d.deltas?.collected} compareLabel={cmp} hint={`${formatNumber(d.summary.transactions)} payments`} />
            <MetricCard label="Confirmed" value={d.summary.confirmed} format="money" />
            <MetricCard label="Awaiting confirmation" value={d.summary.awaitingConfirmation} format="money" tone={d.summary.awaitingConfirmation > 0 ? "warning" : "default"} />
            <MetricCard label="Rental collections" value={d.summary.rentalCollections} format="money" delta={d.deltas?.rentalCollections} compareLabel={cmp} hint={`Deposits ${money(d.summary.securityDeposits)}`} />
            <MetricCard label="Refunds paid out" value={d.summary.refundsPaidOut} format="money" delta={d.deltas?.refundsPaidOut} compareLabel={cmp} invert />
            <MetricCard label="Net" value={d.summary.net} format="money" delta={d.deltas?.net} compareLabel={cmp} />
          </div>

          <Section title="By payment mode">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {MODE_ORDER.map((k) => (
                <MetricCard
                  key={k}
                  testId={`col-mode-${k}`}
                  label={d.modeLabels[k]}
                  value={d.summary.modes[k]}
                  format="money"
                  delta={d.deltas?.[DELTA_KEY[k]]}
                  compareLabel={cmp}
                  hint={d.summary.refundModes[k] ? `Refunded ${money(d.summary.refundModes[k])}` : undefined}
                />
              ))}
              <MetricCard label="Card" value={null} notTracked={d.notTracked.card} />
            </div>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="By staff">
              <RowTable
                rows={d.byStaff}
                rowKey={(r) => r.staff}
                columns={[
                  { header: "Staff", cell: (r) => r.staff },
                  { header: "Payments", cell: (r) => formatNumber(r.transactions), align: "right" },
                  { header: "Cash", cell: (r) => money(r.cash), align: "right" },
                  { header: "Online", cell: (r) => money(r.online), align: "right" },
                  { header: "Awaiting conf.", cell: (r) => money(r.awaitingConfirmation), align: "right" },
                  { header: "Total", cell: (r) => money(r.collected), align: "right" },
                ]}
              />
            </Section>
            <Section title="By purpose">
              <RowTable
                rows={d.byPurpose}
                rowKey={(r) => r.purpose}
                columns={[
                  { header: "Purpose", cell: (r) => r.label },
                  { header: "Direction", cell: (r) => (r.direction === "IN" ? "In" : "Out") },
                  { header: "Count", cell: (r) => formatNumber(r.transactions), align: "right" },
                  { header: "Amount", cell: (r) => money(r.amount), align: "right" },
                ]}
              />
            </Section>
          </div>

          <Section title="Discrepancies: recorded vs received">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard
                testId="col-pending"
                label="Awaiting confirmation (all dates)"
                value={d.discrepancies.awaitingConfirmation.amount}
                format="money"
                hint={`${d.discrepancies.awaitingConfirmation.count} payments recorded, not yet confirmed received`}
                tone={d.discrepancies.awaitingConfirmation.count ? "warning" : "default"}
              />
              <MetricCard label="Voided in period" value={d.discrepancies.voided.amount} format="money" hint={`${d.discrepancies.voided.count} entries reversed as wrong`} />
              <MetricCard label="Rejected in period" value={d.discrepancies.rejected.amount} format="money" hint={`${d.discrepancies.rejected.count} entries`} />
              <MetricCard
                label="Cash shift differences"
                value={d.discrepancies.cashShifts.short + d.discrepancies.cashShifts.over}
                format="money"
                hint={`${d.discrepancies.cashShifts.withDifference} of ${d.discrepancies.cashShifts.closed} closed shifts · short ${money(d.discrepancies.cashShifts.short)} · over ${money(d.discrepancies.cashShifts.over)}`}
                tone={d.discrepancies.cashShifts.withDifference ? "danger" : "default"}
              />
            </div>
            {d.discrepancies.cashShifts.rows.length > 0 && (
              <div className="mt-3">
                <RowTable
                  rows={d.discrepancies.cashShifts.rows}
                  rowKey={(r) => r.publicId}
                  columns={[
                    { header: "Shift", cell: (r) => r.publicId },
                    { header: "Branch", cell: (r) => r.branchName },
                    { header: "Executive", cell: (r) => r.employee },
                    { header: "Closed", cell: (r) => istDateTime(r.closedAt) },
                    { header: "Closed by", cell: (r) => r.closedBy ?? "Not recorded" },
                    { header: "Expected", cell: (r) => money(r.expected), align: "right" },
                    { header: "Counted", cell: (r) => money(r.counted), align: "right" },
                    {
                      header: "Difference",
                      cell: (r) => <span className={r.difference < 0 ? "text-rose-600" : r.difference > 0 ? "text-amber-600" : ""}>{money(r.difference)}</span>,
                      align: "right",
                    },
                    { header: "Explanation", cell: (r) => r.explanation ?? "—" },
                  ]}
                />
              </div>
            )}
            {[...d.discrepancies.voided.rows, ...d.discrepancies.rejected.rows].length > 0 && (
              <div className="mt-3">
                <RowTable
                  rows={[...d.discrepancies.voided.rows, ...d.discrepancies.rejected.rows]}
                  rowKey={(r) => r.publicId}
                  columns={[
                    { header: "Transaction", cell: (r) => r.publicId },
                    { header: "Booking", cell: (r) => r.bookingPublicId },
                    { header: "What", cell: (r) => (r.voidedAt ? "Voided" : "Rejected") },
                    { header: "When", cell: (r) => istDateTime(r.voidedAt ?? r.rejectedAt) },
                    { header: "By", cell: (r) => r.voidedBy ?? r.rejectedBy ?? "Not recorded" },
                    { header: "Reason", cell: (r) => r.voidReason ?? r.rejectionReason ?? "—" },
                    { header: "Amount", cell: (r) => money(r.amount), align: "right" },
                  ]}
                />
              </div>
            )}
          </Section>

          <Section title="Transactions">
            <RowTable
              testId="col-rows"
              rows={d.rows}
              rowKey={(r) => r.publicId}
              columns={[
                { header: "Paid at", cell: (r) => istDateTime(r.paidAt) },
                { header: "Booking", cell: (r) => r.bookingPublicId },
                { header: "Customer", cell: (r) => r.customerName },
                { header: "Purpose", cell: (r) => r.purposeLabel },
                { header: "Status", cell: (r) => <span className={r.counted ? "" : "text-neutral-400 line-through"}>{r.status}</span> },
                { header: "Mode", cell: (r) => r.modeLabel },
                { header: "Reference", cell: (r) => r.reference ?? "—" },
                { header: "Collected by", cell: (r) => r.collectedBy },
                { header: "Confirmed by", cell: (r) => r.confirmedBy ?? "—" },
                { header: "Amount", cell: (r) => (r.direction === "OUT" ? `− ${money(r.amount)}` : money(r.amount)), align: "right" },
              ]}
            />
            <Pager pagination={d.pagination} onPage={setPage} />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}

export default PaymentsCollectionsPage;
