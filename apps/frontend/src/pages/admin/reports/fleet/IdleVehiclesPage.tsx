import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ExportCsvButton, MetricCard, ReportFilterBar, ReportLayout, useReportFilters } from "@/components/admin/reports/framework";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FLEET_API, LoadState, RowTable, Section, istDate, money, statusLabel, useFleetReport } from "./fleetShared";

interface Row {
  publicId: string;
  regNo: string;
  name: string;
  branchName: string;
  categoryName: string;
  status: string;
  neverRented: boolean;
  lastRentalEnd: string | null;
  daysIdle: number;
  revenue90d: number;
  bookings90d: number;
  nextBookingAt: string | null;
  odometer: number;
}
interface IdleData {
  idleDays: number;
  asOf: string;
  summary: { vehicles: number; idle: number; neverRented: number; onRent: number; avgDaysIdle: number | null; revenue90dOfIdle: number };
  rows: Row[];
  notes: string[];
}

export function IdleVehiclesPage() {
  const { filters, setFilters, params } = useReportFilters();
  const [search, setSearch] = useSearchParams();
  const n = Number(search.get("idleDays") || 7) || 7;
  const [draft, setDraft] = useState(String(n));
  // Idle is "as of now": the date range is not sent
  const { preset: _p, from: _f, to: _t, ...scope } = params;
  const q = useFleetReport<IdleData>("idle", scope, { idleDays: n });
  const d = q.data;
  const apply = () => {
    const v = Math.min(365, Math.max(1, Math.floor(Number(draft) || 7)));
    setDraft(String(v));
    setSearch((prev) => {
      const next = new URLSearchParams(prev);
      next.set("idleDays", String(v));
      return next;
    }, { replace: true });
  };

  return (
    <ReportLayout
      title="Idle Vehicles"
      section="4.2"
      description={`Vehicles with no rental in the last ${n} day(s), as of now.`}
      filters={
        <div className="flex flex-col gap-3">
          <ReportFilterBar value={filters} onChange={setFilters} show={{ dates: false }} />
          <div className="flex items-end gap-2">
            <label className="text-sm text-neutral-700">
              Not rented for at least
              <Input data-testid="idle-days-input" type="number" min={1} max={365} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} className="mt-1 h-9 w-28" />
            </label>
            <span className="pb-2 text-sm text-neutral-600">days</span>
            <Button size="sm" variant="outline" onClick={apply} data-testid="idle-days-apply">
              Apply
            </Button>
          </div>
        </div>
      }
      actions={<ExportCsvButton endpoint={`${FLEET_API}/idle`} params={{ ...scope, idleDays: n }} filename={`idle-vehicles-${n}d`} />}
      notes={[...(d?.notes ?? []), "This is a snapshot, so no date range or previous-period comparison applies."]}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard testId="idle-count" label="Idle vehicles" value={d.summary.idle} hint={`of ${d.summary.vehicles} vehicles · ${d.summary.onRent} on rent now`} tone={d.summary.idle > 0 ? "warning" : "default"} />
            <MetricCard label="Never rented" value={d.summary.neverRented} />
            <MetricCard label="Average days idle" value={d.summary.avgDaysIdle} format="days" />
            <MetricCard label="Their revenue, last 90 days" value={d.summary.revenue90dOfIdle} format="money" />
          </div>
          <Section title="Idle vehicles">
            <RowTable
              testId="idle-rows"
              rows={d.rows}
              rowKey={(r) => r.publicId}
              empty="No idle vehicles for these filters."
              columns={[
                { header: "Reg No", cell: (r) => r.regNo },
                { header: "Vehicle", cell: (r) => r.name },
                { header: "Branch", cell: (r) => r.branchName },
                { header: "Category", cell: (r) => r.categoryName },
                { header: "Status now", cell: (r) => statusLabel(r.status) },
                { header: "Last rental ended", cell: (r) => (r.neverRented ? "Never rented" : istDate(r.lastRentalEnd)) },
                { header: "Days idle", cell: (r) => <strong>{r.daysIdle}</strong>, align: "right" },
                { header: "Revenue (90 d)", cell: (r) => money(r.revenue90d), align: "right" },
                { header: "Bookings (90 d)", cell: (r) => r.bookings90d, align: "right" },
                { header: "Next booking", cell: (r) => (r.nextBookingAt ? istDate(r.nextBookingAt) : "None") },
              ]}
            />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}

export default IdleVehiclesPage;
