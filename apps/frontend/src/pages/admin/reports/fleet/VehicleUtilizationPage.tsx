import { useState } from "react";
import { ExportCsvButton, MetricCard, ReportFilterBar, ReportLayout, useReportFilters } from "@/components/admin/reports/framework";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FLEET_API, LoadState, RowTable, Section, compareLabel, days, pctText, statusLabel, useFleetReport, type Deltas, type PrevInfo } from "./fleetShared";

interface Group {
  publicId: string | null;
  name: string;
  vehicles: number;
  rangeDays: number;
  downtimeDays: number;
  availableDays: number;
  rentedDays: number;
  utilizationPct: number | null;
  untrackedDays: number;
}
interface VehicleRow {
  publicId: string;
  regNo: string;
  name: string;
  branchName: string;
  categoryName: string;
  status: string;
  rangeDays: number;
  rentedDays: number;
  downtimeDays: number;
  availableDays: number;
  utilizationPct: number | null;
  untrackedDays: number;
  rentals: number;
}
interface UtilData {
  totals: Group;
  byBranch: Group[];
  byCategory: Group[];
  vehicles: VehicleRow[];
  historyKnownFrom: string | null;
  notes: string[];
  previous: PrevInfo | null;
  previousByCategory: Group[] | null;
  deltas: Deltas<"utilizationPct" | "rentedDays" | "availableDays" | "downtimeDays">;
}

const groupCols = (label: string, prev?: Map<string | null, Group>) => [
  { header: label, cell: (r: Group) => r.name },
  { header: "Vehicles", cell: (r: Group) => r.vehicles, align: "right" as const },
  { header: "Days in range", cell: (r: Group) => days(r.rangeDays), align: "right" as const },
  { header: "Downtime", cell: (r: Group) => days(r.downtimeDays), align: "right" as const },
  { header: "Available", cell: (r: Group) => days(r.availableDays), align: "right" as const },
  { header: "Rented", cell: (r: Group) => days(r.rentedDays), align: "right" as const },
  { header: "Utilization", cell: (r: Group) => <strong>{pctText(r.utilizationPct)}</strong>, align: "right" as const },
  ...(prev
    ? [{ header: "Previous", cell: (r: Group) => pctText(prev.get(r.publicId)?.utilizationPct ?? null), align: "right" as const }]
    : []),
];

export function VehicleUtilizationPage() {
  const { filters, setFilters, params } = useReportFilters();
  const [view, setView] = useState<"vehicles" | "categories" | "branches">("vehicles");
  const q = useFleetReport<UtilData>("utilization", params);
  const d = q.data;
  const cmp = compareLabel(d?.previous);
  const prevCat = d?.previousByCategory ? new Map(d.previousByCategory.map((g) => [g.publicId, g])) : undefined;

  return (
    <ReportLayout
      title="Vehicle Utilization"
      section="4.1"
      description="Rented days ÷ available days per vehicle, category and branch."
      filters={<ReportFilterBar value={filters} onChange={setFilters} />}
      actions={<ExportCsvButton endpoint={`${FLEET_API}/utilization`} params={params} filename="vehicle-utilization" />}
      notes={[
        "Utilization % = rented days ÷ available days × 100. Rented days = actual handover to return of each rental (an active rental counts up to now), split per car at mid-rental swaps.",
        "Available days = days in the range (from when the vehicle was added, never beyond today) − downtime (Maintenance, Damage review, Inactive, and booking locks that block staff bookings). Time out on a rental is never downtime. Same rule as the Vehicle Downtime report.",
        "Category and branch figures add up the days of their vehicles, then divide.",
        ...(d?.notes ?? []),
      ]}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard testId="util-pct" label="Fleet utilization" value={d.totals.utilizationPct} format="percent" delta={d.deltas?.utilizationPct} compareLabel={cmp} hint={`${d.totals.vehicles} vehicles`} />
            <MetricCard testId="util-rented" label="Rented days" value={d.totals.rentedDays} format="days" delta={d.deltas?.rentedDays} compareLabel={cmp} />
            <MetricCard testId="util-available" label="Available days" value={d.totals.availableDays} format="days" delta={d.deltas?.availableDays} compareLabel={cmp} hint={`of ${days(d.totals.rangeDays)} in range`} />
            <MetricCard testId="util-downtime" label="Downtime days" value={d.totals.downtimeDays} format="days" delta={d.deltas?.downtimeDays} compareLabel={cmp} invert to={`/admin/reports/fleet/downtime?${new URLSearchParams(params).toString()}`} />
          </div>
          {d.totals.untrackedDays > 0 && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" data-testid="util-untracked">
              {days(d.totals.untrackedDays)} of this range fall before vehicle status history was recorded. They count as available because downtime then is not known.
            </p>
          )}
          <Section
            title={view === "vehicles" ? "By vehicle" : view === "categories" ? "By category" : "By branch"}
            actions={
              <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
                <TabsList>
                  <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
                  <TabsTrigger value="categories">Categories</TabsTrigger>
                  <TabsTrigger value="branches">Branches</TabsTrigger>
                </TabsList>
              </Tabs>
            }
          >
            {view === "vehicles" && (
              <RowTable
                testId="util-vehicles"
                rows={d.vehicles}
                rowKey={(r) => r.publicId}
                columns={[
                  { header: "Reg No", cell: (r) => r.regNo },
                  { header: "Vehicle", cell: (r) => r.name },
                  { header: "Branch", cell: (r) => r.branchName },
                  { header: "Category", cell: (r) => r.categoryName },
                  { header: "Status now", cell: (r) => statusLabel(r.status) },
                  { header: "Rentals", cell: (r) => r.rentals, align: "right" },
                  { header: "Downtime", cell: (r) => days(r.downtimeDays), align: "right" },
                  { header: "Available", cell: (r) => days(r.availableDays), align: "right" },
                  { header: "Rented", cell: (r) => days(r.rentedDays), align: "right" },
                  { header: "Utilization", cell: (r) => <strong>{pctText(r.utilizationPct)}</strong>, align: "right" },
                  { header: "Untracked", cell: (r) => (r.untrackedDays > 0 ? days(r.untrackedDays) : "—"), align: "right" },
                ]}
              />
            )}
            {view === "categories" && <RowTable testId="util-categories" rows={d.byCategory} rowKey={(r) => r.publicId ?? r.name} columns={groupCols("Category", prevCat)} />}
            {view === "branches" && <RowTable testId="util-branches" rows={d.byBranch} rowKey={(r) => r.publicId ?? r.name} columns={groupCols("Branch")} />}
          </Section>
        </>
      )}
    </ReportLayout>
  );
}

export default VehicleUtilizationPage;
