import { useState } from "react";
import { ExportCsvButton, MetricCard, ReportFilterBar, ReportLayout, formatNumber, useReportFilters } from "@/components/admin/reports/framework";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FLEET_API, LoadState, RowTable, Section, compareLabel, istDate, money, useFleetReport, type Deltas, type PrevInfo } from "./fleetShared";

interface Trip {
  bookingPublicId: string;
  customerName: string;
  branchName: string;
  vehicles: string;
  startAt: string;
  returnedAt: string;
  startOdometer: number | null;
  endOdometer: number | null;
  swaps: number;
  totalKm: number | null;
  freeKm: number | null;
  extraKm: number | null;
  extraKmCharged: number;
  extraKmCollected: number;
  extraKmOutstanding: number;
}
interface VehicleRow {
  publicId: string;
  regNo: string;
  name: string;
  branchName: string;
  categoryName: string;
  odometer: number;
  trips: number;
  km: number;
  unknownKmTrips: number;
  avgKmPerTrip: number | null;
  extraKm: number;
  extraKmCharged: number;
  extraKmCollected: number;
}
interface KmData {
  totals: {
    trips: number;
    tripsWithKm: number;
    totalKm: number;
    avgKmPerTrip: number | null;
    tripsWithExtraKm: number;
    extraKm: number;
    extraKmCharged: number;
    extraKmCollected: number;
    extraKmOutstanding: number;
  };
  vehicles: VehicleRow[];
  trips: Trip[];
  notes: string[];
  previous: PrevInfo | null;
  deltas: Deltas<"totalKm" | "trips" | "avgKmPerTrip" | "extraKmCharged">;
}

const km = (v: number | null | undefined) => (v === null || v === undefined ? "Not recorded" : `${formatNumber(v)} km`);

export function KmMileagePage() {
  const { filters, setFilters, params } = useReportFilters();
  const [view, setView] = useState<"vehicles" | "trips">("vehicles");
  const q = useFleetReport<KmData>("km", params);
  const d = q.data;
  const cmp = compareLabel(d?.previous);

  return (
    <ReportLayout
      title="Kilometres & Mileage"
      section="4.4"
      description="Km driven per trip and per vehicle, and excess-km charges."
      filters={<ReportFilterBar value={filters} onChange={setFilters} />}
      actions={
        <>
          <ExportCsvButton endpoint={`${FLEET_API}/km`} params={{ ...params, view: "vehicles" }} filename="km-by-vehicle" label="Export vehicles" />
          <ExportCsvButton endpoint={`${FLEET_API}/km`} params={params} filename="km-by-trip" label="Export trips" />
        </>
      }
      notes={d?.notes ?? []}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard testId="km-total" label="Km driven" value={d.totals.totalKm} delta={d.deltas?.totalKm} compareLabel={cmp} hint={`${d.totals.tripsWithKm} of ${d.totals.trips} trips with km recorded`} />
            <MetricCard testId="km-avg" label="Average km per trip" value={d.totals.avgKmPerTrip} delta={d.deltas?.avgKmPerTrip} compareLabel={cmp} />
            <MetricCard testId="km-extra-charged" label="Extra-km charged" value={d.totals.extraKmCharged} format="money" delta={d.deltas?.extraKmCharged} compareLabel={cmp} hint={`${formatNumber(d.totals.extraKm)} extra km on ${d.totals.tripsWithExtraKm} trips`} />
            <MetricCard testId="km-extra-collected" label="Extra-km collected" value={d.totals.extraKmCollected} format="money" hint={`Outstanding ${money(d.totals.extraKmOutstanding)} (pro-rata)`} tone={d.totals.extraKmOutstanding > 0 ? "warning" : "default"} />
          </div>
          <Section
            title={view === "vehicles" ? "By vehicle" : "By trip"}
            actions={
              <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
                <TabsList>
                  <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
                  <TabsTrigger value="trips">Trips</TabsTrigger>
                </TabsList>
              </Tabs>
            }
          >
            {view === "vehicles" ? (
              <RowTable
                testId="km-vehicles"
                rows={d.vehicles}
                rowKey={(r) => r.publicId}
                columns={[
                  { header: "Reg No", cell: (r) => r.regNo },
                  { header: "Vehicle", cell: (r) => r.name },
                  { header: "Branch", cell: (r) => r.branchName },
                  { header: "Trips", cell: (r) => r.trips, align: "right" },
                  { header: "Km driven", cell: (r) => <strong>{km(r.km)}</strong>, align: "right" },
                  { header: "Avg / trip", cell: (r) => km(r.avgKmPerTrip), align: "right" },
                  { header: "Unknown-km trips", cell: (r) => r.unknownKmTrips || "—", align: "right" },
                  { header: "Extra km", cell: (r) => formatNumber(r.extraKm), align: "right" },
                  { header: "Extra-km charged", cell: (r) => money(r.extraKmCharged), align: "right" },
                  { header: "Collected", cell: (r) => money(r.extraKmCollected), align: "right" },
                  { header: "Odometer now", cell: (r) => km(r.odometer), align: "right" },
                ]}
              />
            ) : (
              <RowTable
                testId="km-trips"
                rows={d.trips}
                rowKey={(r) => r.bookingPublicId}
                columns={[
                  { header: "Booking", cell: (r) => r.bookingPublicId },
                  { header: "Customer", cell: (r) => r.customerName },
                  { header: "Vehicle(s)", cell: (r) => r.vehicles },
                  { header: "Returned", cell: (r) => istDate(r.returnedAt) },
                  { header: "Start odo", cell: (r) => km(r.startOdometer), align: "right" },
                  { header: "End odo", cell: (r) => km(r.endOdometer), align: "right" },
                  { header: "Swaps", cell: (r) => r.swaps || "—", align: "right" },
                  { header: "Km", cell: (r) => <strong>{km(r.totalKm)}</strong>, align: "right" },
                  { header: "Free km", cell: (r) => km(r.freeKm), align: "right" },
                  { header: "Extra km", cell: (r) => (r.extraKm == null ? "—" : formatNumber(r.extraKm)), align: "right" },
                  { header: "Charged", cell: (r) => money(r.extraKmCharged), align: "right" },
                  { header: "Collected", cell: (r) => money(r.extraKmCollected), align: "right" },
                ]}
              />
            )}
          </Section>
        </>
      )}
    </ReportLayout>
  );
}

export default KmMileagePage;
