import { useSearchParams } from "react-router-dom";
import { ExportCsvButton, MetricCard, ReportFilterBar, ReportLayout, useReportFilters } from "@/components/admin/reports/framework";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FLEET_API, LoadState, RowTable, Section, istDate, useFleetReport } from "./fleetShared";

type DocType = "INSURANCE" | "RC" | "PERMIT" | "PUC" | "FITNESS";
type Status = "EXPIRED" | "EXPIRING_7" | "EXPIRING_30";
interface Row {
  vehiclePublicId: string;
  regNo: string;
  make: string;
  model: string;
  branchName: string;
  categoryName: string;
  docType: DocType;
  expiryDate: string;
  daysLeft: number;
  status: Status;
}
interface ExpiryData {
  asOf: string;
  vehicles: number;
  summary: { expired: number; expiring7: number; expiring30: number; total: number };
  notRecorded: Record<DocType, number>;
  rows: Row[];
  notes: string[];
}

const DOC_LABELS: Record<DocType, string> = { INSURANCE: "Insurance", RC: "RC", PERMIT: "Permit", PUC: "PUC", FITNESS: "Fitness" };
const STATUS_UI: Record<Status, { label: string; cls: string }> = {
  EXPIRED: { label: "Expired", cls: "bg-rose-100 text-rose-700" },
  EXPIRING_7: { label: "Expiring ≤7d", cls: "bg-amber-100 text-amber-800" },
  EXPIRING_30: { label: "Expiring ≤30d", cls: "bg-yellow-50 text-yellow-800" },
};

export function DocumentExpiryPage() {
  const { filters, setFilters, params } = useReportFilters();
  const [search, setSearch] = useSearchParams();
  const docType = search.get("docType") || "all";
  const status = search.get("status") || "all";
  const { preset: _p, from: _f, to: _t, ...scope } = params;
  const extra: Record<string, string> = {};
  if (docType !== "all") extra.docType = docType;
  if (status !== "all") extra.status = status;
  const q = useFleetReport<ExpiryData>("document-expiry", scope, extra);
  const d = q.data;
  const setParam = (k: string, v: string) =>
    setSearch((prev) => {
      const next = new URLSearchParams(prev);
      if (v === "all") next.delete(k);
      else next.set(k, v);
      return next;
    }, { replace: true });
  const recordedGaps = d ? (Object.entries(d.notRecorded) as [DocType, number][]).filter(([, n]) => n > 0) : [];

  return (
    <ReportLayout
      title="Vehicle Document Expiry"
      section="6.1"
      description="Insurance, RC, permit, PUC and fitness documents expired or expiring in the next 30 days."
      filters={
        <div className="flex flex-col gap-3">
          <ReportFilterBar value={filters} onChange={setFilters} show={{ dates: false }} />
          <div className="flex flex-wrap gap-3">
            <Select value={docType} onValueChange={(v) => setParam("docType", v)}>
              <SelectTrigger className="h-9 w-44" data-testid="doc-type-filter">
                <SelectValue placeholder="Document" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All documents</SelectItem>
                {(Object.keys(DOC_LABELS) as DocType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {DOC_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setParam("status", v)}>
              <SelectTrigger className="h-9 w-44" data-testid="doc-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
                <SelectItem value="EXPIRING_7">Expiring ≤7 days</SelectItem>
                <SelectItem value="EXPIRING_30">Expiring 8–30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      }
      actions={<ExportCsvButton endpoint={`${FLEET_API}/document-expiry`} params={{ ...scope, ...extra }} filename="vehicle-document-expiry" />}
      notes={[...(d?.notes ?? []), "This is a snapshot as of today, so no date range or previous-period comparison applies."]}
    >
      <LoadState isLoading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard testId="doc-expired" label="Expired" value={d.summary.expired} tone={d.summary.expired > 0 ? "danger" : "default"} />
            <MetricCard testId="doc-7" label="Expiring in ≤7 days" value={d.summary.expiring7} tone={d.summary.expiring7 > 0 ? "warning" : "default"} />
            <MetricCard testId="doc-30" label="Expiring in 8–30 days" value={d.summary.expiring30} />
            <MetricCard label="Vehicles checked" value={d.vehicles} hint="Active vehicles only" />
          </div>
          {recordedGaps.length > 0 && (
            <p className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700" data-testid="doc-not-recorded">
              Expiry date not recorded: {recordedGaps.map(([t, n]) => `${DOC_LABELS[t]} ${n}`).join(" · ")} vehicle(s). Add them on the branch manager's vehicle form.
            </p>
          )}
          <Section title="Documents">
            <RowTable
              testId="doc-rows"
              rows={d.rows}
              rowKey={(r) => `${r.vehiclePublicId}-${r.docType}`}
              empty="Nothing expired or expiring in the next 30 days."
              columns={[
                { header: "Reg No", cell: (r) => r.regNo },
                { header: "Vehicle", cell: (r) => `${r.make} ${r.model}` },
                { header: "Branch", cell: (r) => r.branchName },
                { header: "Category", cell: (r) => r.categoryName },
                { header: "Document", cell: (r) => DOC_LABELS[r.docType] },
                { header: "Expiry date", cell: (r) => istDate(r.expiryDate) },
                { header: "Days left", cell: (r) => (r.daysLeft < 0 ? `${-r.daysLeft} d ago` : r.daysLeft === 0 ? "Today" : `${r.daysLeft} d`), align: "right" },
                { header: "Status", cell: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_UI[r.status].cls}`}>{STATUS_UI[r.status].label}</span> },
              ]}
            />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}

export default DocumentExpiryPage;
