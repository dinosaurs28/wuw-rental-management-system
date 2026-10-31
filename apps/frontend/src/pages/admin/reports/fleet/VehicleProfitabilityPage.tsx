import { Link } from "react-router-dom";
import { ExportCsvButton, MetricCard, ReportFilterBar, ReportLayout, useReportFilters } from "@/components/admin/reports/framework";
import { FLEET_API, LoadState, RowTable, Section, compareLabel, money, pctText, useFleetReport, type Deltas, type PrevInfo } from "./fleetShared";

interface Row {
  publicId: string;
  regNo: string;
  name: string;
  branchName: string;
  categoryName: string;
  bookings: number;
  revenue: number;
  maintenance: number;
  repair: number;
  other: number;
  totalCost: number;
  profit: number;
  marginPct: number | null;
  costsCaptured: boolean;
}
interface Totals {
  vehicles: number;
  revenue: number;
  maintenance: number;
  repair: number;
  other: number;
  totalCost: number;
  profit: number;
  vehiclesWithCosts: number;
  marginPct: number | null;
}
interface ProfitData {
  totals: Totals;
  byCategory: Array<{ publicId: string; name: string; revenue: number; totalCost: number; profit: number; vehicles: number }>;
  rows: Row[];
  costsCaptured: boolean;
  notes: string[];
  previous: PrevInfo | null;
  deltas: Deltas<"revenue" | "totalCost" | "profit">;
}

export function VehicleProfitabilityPage() {
  const { filters, setFilters, params } = useReportFilters();
  const q = useFleetReport<ProfitData>("profitability", params);
  const d = q.data;
  const cmp = compareLabel(d?.previous);

  return (
    <ReportLayout
      title="Vehicle Profitability"
      section="4.3"
      description="Revenue minus recorded costs per vehicle."
      filters={<ReportFilterBar value={filters} onChange={setFilters} />}
      actions={
        <>
          <Link to="/admin/reports/fleet/expenses" className="inline-flex h-9 items-center rounded-md border border-neutral-200 px-3 text-sm hover:bg-neutral-50">
            Record costs
          </Link>
          <ExportCsvButton endpoint={`${FLEET_API}/profitability`} params={params} filename="vehicle-profitability" />
        </>
      }
      notes={d?.notes ?? []}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          {!d.costsCaptured && (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-testid="profit-no-costs">
              No vehicle costs are recorded for this range, so profit equals revenue. Record maintenance, repair and other costs on the <Link className="underline" to="/admin/reports/fleet/expenses">Vehicle expenses</Link> page.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard testId="profit-revenue" label="Revenue" value={d.totals.revenue} format="money" delta={d.deltas?.revenue} compareLabel={cmp} />
            <MetricCard testId="profit-cost" label="Recorded costs" value={d.totals.totalCost} format="money" delta={d.deltas?.totalCost} compareLabel={cmp} invert hint={`${d.totals.vehiclesWithCosts} of ${d.totals.vehicles} vehicles have costs recorded`} />
            <MetricCard testId="profit-profit" label="Profit" value={d.totals.profit} format="money" delta={d.deltas?.profit} compareLabel={cmp} tone={d.totals.profit < 0 ? "danger" : "default"} />
            <MetricCard label="Margin" value={d.totals.marginPct} format="percent" hint={`Maintenance ${money(d.totals.maintenance)} · Repair ${money(d.totals.repair)} · Other ${money(d.totals.other)}`} />
          </div>
          <Section title="By vehicle">
            <RowTable
              testId="profit-rows"
              rows={d.rows}
              rowKey={(r) => r.publicId}
              columns={[
                { header: "Reg No", cell: (r) => r.regNo },
                { header: "Vehicle", cell: (r) => r.name },
                { header: "Branch", cell: (r) => r.branchName },
                { header: "Category", cell: (r) => r.categoryName },
                { header: "Bookings", cell: (r) => r.bookings, align: "right" },
                { header: "Revenue", cell: (r) => money(r.revenue), align: "right" },
                { header: "Maintenance", cell: (r) => money(r.maintenance), align: "right" },
                { header: "Repair", cell: (r) => money(r.repair), align: "right" },
                { header: "Other", cell: (r) => money(r.other), align: "right" },
                { header: "Profit", cell: (r) => <strong className={r.profit < 0 ? "text-rose-600" : ""}>{money(r.profit)}</strong>, align: "right" },
                { header: "Margin", cell: (r) => pctText(r.marginPct), align: "right" },
                { header: "Costs", cell: (r) => (r.costsCaptured ? "Recorded" : <span className="text-amber-700">Not captured</span>) },
              ]}
            />
          </Section>
          <Section title="By category">
            <RowTable
              testId="profit-categories"
              rows={d.byCategory}
              rowKey={(r) => r.publicId}
              columns={[
                { header: "Category", cell: (r) => r.name },
                { header: "Vehicles", cell: (r) => r.vehicles, align: "right" },
                { header: "Revenue", cell: (r) => money(r.revenue), align: "right" },
                { header: "Recorded costs", cell: (r) => money(r.totalCost), align: "right" },
                { header: "Profit", cell: (r) => <strong>{money(r.profit)}</strong>, align: "right" },
              ]}
            />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}

export default VehicleProfitabilityPage;
