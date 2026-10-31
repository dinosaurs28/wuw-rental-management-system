import { useState } from "react";
import { ExportCsvButton, MetricCard, ReportFilterBar, ReportLayout, useReportFilters } from "@/components/admin/reports/framework";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DOWNTIME_LABELS,
  FLEET_API,
  LoadState,
  RowTable,
  Section,
  compareLabel,
  days,
  istDateTime,
  pctText,
  statusLabel,
  useFleetReport,
  type Deltas,
  type PrevInfo,
} from "./fleetShared";

type Kind = "MAINTENANCE" | "MANAGER_REPORTED" | "INACTIVE" | "BOOKING_LOCK";
interface VehicleRow {
  publicId: string;
  regNo: string;
  name: string;
  branchName: string;
  categoryName: string;
  status: string;
  rangeDays: number;
  downtimeDays: number;
  availableDays: number;
  rentedDays: number;
  utilizationPct: number | null;
  utilizationInclDowntimePct: number | null;
  untrackedDays: number;
  downtimeByKind: Record<Kind, number>;
}
interface Episode {
  vehiclePublicId: string;
  regNo: string;
  branchName: string;
  kind: Kind;
  start: string;
  end: string | null;
  days: number;
  reason: string | null;
}
interface DowntimeData {
  totals: {
    vehicles: number;
    rangeDays: number;
    downtimeDays: number;
    availableDays: number;
    rentedDays: number;
    utilizationPct: number | null;
    utilizationInclDowntimePct: number | null;
    utilizationEffectPts: number | null;
    untrackedDays: number;
    vehiclesWithDowntime: number;
    byKind: Record<Kind, number>;
  };
  vehicles: VehicleRow[];
  episodes: Episode[];
  notes: string[];
  previous: PrevInfo | null;
  deltas: Deltas<"downtimeDays" | "vehiclesWithDowntime" | "utilizationPct">;
}

export function VehicleDowntimePage() {
  const { filters, setFilters, params } = useReportFilters();
  const [view, setView] = useState<"vehicles" | "episodes">("vehicles");
  const q = useFleetReport<DowntimeData>("downtime", params);
  const d = q.data;
  const cmp = compareLabel(d?.previous);

  return (
    <ReportLayout
      title="Vehicle Downtime"
      section="5.2"
      description="Days each vehicle was out of service, and what that does to utilization."
      filters={<ReportFilterBar value={filters} onChange={setFilters} />}
      actions={
        <>
          <ExportCsvButton endpoint={`${FLEET_API}/downtime`} params={params} filename="vehicle-downtime" label="Export vehicles" />
          <ExportCsvButton endpoint={`${FLEET_API}/downtime`} params={{ ...params, view: "episodes" }} filename="vehicle-downtime-periods" label="Export periods" />
        </>
      }
      notes={d?.notes ?? []}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard testId="dt-total" label="Downtime days" value={d.totals.downtimeDays} format="days" delta={d.deltas?.downtimeDays} compareLabel={cmp} invert hint={`${d.totals.vehiclesWithDowntime} of ${d.totals.vehicles} vehicles`} />
            <MetricCard label="Maintenance" value={d.totals.byKind.MAINTENANCE} format="days" />
            <MetricCard label="Damage review" value={d.totals.byKind.MANAGER_REPORTED} format="days" />
            <MetricCard label="Inactive / locked" value={d.totals.byKind.INACTIVE + d.totals.byKind.BOOKING_LOCK} format="days" hint={`Inactive ${days(d.totals.byKind.INACTIVE)} · Locks ${days(d.totals.byKind.BOOKING_LOCK)}`} />
            <MetricCard testId="dt-util" label="Utilization (downtime excluded)" value={d.totals.utilizationPct} format="percent" delta={d.deltas?.utilizationPct} compareLabel={cmp} />
            <MetricCard testId="dt-util-incl" label="Utilization if downtime counted" value={d.totals.utilizationInclDowntimePct} format="percent" hint="Rented ÷ all days in range" />
            <MetricCard label="Effect of downtime" value={d.totals.utilizationEffectPts == null ? null : `${d.totals.utilizationEffectPts.toFixed(1)} pts`} format="text" hint="Difference between the two utilization figures" />
            <MetricCard label="Untracked days" value={d.totals.untrackedDays} format="days" hint="Before status history was recorded" tone={d.totals.untrackedDays > 0 ? "warning" : "default"} />
          </div>
          <Section
            title={view === "vehicles" ? "By vehicle" : "Downtime periods"}
            actions={
              <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
                <TabsList>
                  <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
                  <TabsTrigger value="episodes">Periods</TabsTrigger>
                </TabsList>
              </Tabs>
            }
          >
            {view === "vehicles" ? (
              <RowTable
                testId="dt-vehicles"
                rows={d.vehicles}
                rowKey={(r) => r.publicId}
                columns={[
                  { header: "Reg No", cell: (r) => r.regNo },
                  { header: "Vehicle", cell: (r) => r.name },
                  { header: "Branch", cell: (r) => r.branchName },
                  { header: "Status now", cell: (r) => statusLabel(r.status) },
                  { header: "Maintenance", cell: (r) => days(r.downtimeByKind.MAINTENANCE), align: "right" },
                  { header: "Damage review", cell: (r) => days(r.downtimeByKind.MANAGER_REPORTED), align: "right" },
                  { header: "Inactive", cell: (r) => days(r.downtimeByKind.INACTIVE), align: "right" },
                  { header: "Locks", cell: (r) => days(r.downtimeByKind.BOOKING_LOCK), align: "right" },
                  { header: "Total downtime", cell: (r) => <strong>{days(r.downtimeDays)}</strong>, align: "right" },
                  { header: "Utilization", cell: (r) => pctText(r.utilizationPct), align: "right" },
                  { header: "If counted", cell: (r) => pctText(r.utilizationInclDowntimePct), align: "right" },
                  { header: "Untracked", cell: (r) => (r.untrackedDays > 0 ? days(r.untrackedDays) : "—"), align: "right" },
                ]}
              />
            ) : (
              <RowTable
                testId="dt-episodes"
                rows={d.episodes}
                rowKey={(r, i) => `${r.vehiclePublicId}-${r.kind}-${i}`}
                empty="No downtime recorded in this range."
                columns={[
                  { header: "Reg No", cell: (r) => r.regNo },
                  { header: "Branch", cell: (r) => r.branchName },
                  { header: "Cause", cell: (r) => DOWNTIME_LABELS[r.kind] ?? r.kind },
                  { header: "From", cell: (r) => istDateTime(r.start) },
                  { header: "To", cell: (r) => (r.end ? istDateTime(r.end) : "Ongoing") },
                  { header: "Days", cell: (r) => days(r.days), align: "right" },
                  { header: "Reason", cell: (r) => r.reason ?? "—" },
                ]}
              />
            )}
          </Section>
        </>
      )}
    </ReportLayout>
  );
}

export default VehicleDowntimePage;
