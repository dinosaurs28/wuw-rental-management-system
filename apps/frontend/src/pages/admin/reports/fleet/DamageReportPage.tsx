import { Link } from "react-router-dom";
import { ExportCsvButton, MetricCard, ReportFilterBar, ReportLayout, useReportFilters } from "@/components/admin/reports/framework";
import { FLEET_API, LoadState, RowTable, Section, compareLabel, istDate, money, useFleetReport, type Deltas, type PrevInfo } from "./fleetShared";

interface Row {
  publicId: string;
  loggedAt: string;
  bookingPublicId: string;
  customerName: string;
  regNo: string;
  branchName: string;
  severity: string;
  chargeType: string;
  status: string;
  chargedAtDrop: boolean;
  estimatedCost: number;
  chargedToCustomer: number;
  recovered: number;
  unrecovered: number;
  repairCost: number | null;
  difference: number | null;
}
interface DamageData {
  totals: {
    damages: number;
    pending: number;
    pendingEstimated: number;
    chargedToCustomer: number;
    recovered: number;
    unrecovered: number;
    withRepairCost: number;
    repairCost: number;
    recoveredOnRepaired: number;
    difference: number;
  };
  rows: Row[];
  notes: string[];
  previous: PrevInfo | null;
  deltas: Deltas<"damages" | "chargedToCustomer" | "recovered" | "repairCost">;
}

const STATUS: Record<string, string> = { PENDING: "Pending review", APPROVED: "Closed", REJECTED: "Rejected" };

export function DamageReportPage() {
  const { filters, setFilters, params } = useReportFilters();
  const q = useFleetReport<DamageData>("damage", params);
  const d = q.data;
  const cmp = compareLabel(d?.previous);

  return (
    <ReportLayout
      title="Damage Report"
      section="5.1"
      description="Damages logged, repair cost, amount recovered from the customer, and the gap."
      filters={<ReportFilterBar value={filters} onChange={setFilters} />}
      actions={
        <>
          <Link to="/admin/reports/fleet/expenses" className="inline-flex h-9 items-center rounded-md border border-neutral-200 px-3 text-sm hover:bg-neutral-50">
            Record repair costs
          </Link>
          <ExportCsvButton endpoint={`${FLEET_API}/damage`} params={params} filename="damage-report" />
        </>
      }
      notes={d?.notes ?? []}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard testId="dmg-count" label="Damages logged" value={d.totals.damages} delta={d.deltas?.damages} compareLabel={cmp} invert hint={`${d.totals.pending} pending review (est. ${money(d.totals.pendingEstimated)})`} />
            <MetricCard testId="dmg-charged" label="Charged to customers" value={d.totals.chargedToCustomer} format="money" delta={d.deltas?.chargedToCustomer} compareLabel={cmp} />
            <MetricCard testId="dmg-recovered" label="Recovered" value={d.totals.recovered} format="money" delta={d.deltas?.recovered} compareLabel={cmp} hint={`Unrecovered ${money(d.totals.unrecovered)}`} tone={d.totals.unrecovered > 0 ? "warning" : "default"} />
            {d.totals.withRepairCost > 0 ? (
              <MetricCard
                testId="dmg-gap"
                label="Repair cost − recovered"
                value={d.totals.difference}
                format="money"
                invert
                tone={d.totals.difference > 0 ? "danger" : "success"}
                hint={`Repair ${money(d.totals.repairCost)} vs recovered ${money(d.totals.recoveredOnRepaired)} on ${d.totals.withRepairCost} damage(s)`}
              />
            ) : (
              <MetricCard testId="dmg-gap" label="Repair cost − recovered" value={null} notTracked="No repair costs recorded for these damages yet." />
            )}
          </div>
          <Section title="Damages">
            <RowTable
              testId="dmg-rows"
              rows={d.rows}
              rowKey={(r) => r.publicId}
              empty="No damages logged in this range."
              columns={[
                { header: "Logged", cell: (r) => istDate(r.loggedAt) },
                { header: "Booking", cell: (r) => r.bookingPublicId },
                { header: "Customer", cell: (r) => r.customerName },
                { header: "Reg No", cell: (r) => r.regNo },
                { header: "Severity", cell: (r) => r.severity },
                { header: "Status", cell: (r) => (STATUS[r.status] ?? r.status) + (r.chargedAtDrop ? " · at drop" : "") },
                { header: "Charged", cell: (r) => (r.status === "PENDING" && !r.chargedAtDrop ? `Est. ${money(r.estimatedCost)}` : money(r.chargedToCustomer)), align: "right" },
                { header: "Recovered", cell: (r) => money(r.recovered), align: "right" },
                { header: "Repair cost", cell: (r) => (r.repairCost == null ? <span className="text-neutral-500">Not recorded</span> : money(r.repairCost)), align: "right" },
                {
                  header: "Repair − recovered",
                  cell: (r) => (r.difference == null ? "—" : <strong className={r.difference > 0 ? "text-rose-600" : "text-emerald-700"}>{money(r.difference)}</strong>),
                  align: "right",
                },
              ]}
            />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}

export default DamageReportPage;
