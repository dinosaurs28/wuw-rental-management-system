import { Link } from "react-router-dom";
import { ChevronRight, FileSpreadsheet, GitCompare } from "lucide-react";
import { ReportLayout } from "@/components/admin/reports/framework";
import { cn } from "@/lib/utils";
import { REPORT_SECTIONS } from "./reportRegistry";

/** Reports Hub — every report grouped by spec section, each marked available or coming soon. */
export const ReportsHubPage = () => {
  const all = REPORT_SECTIONS.flatMap((s) => s.reports).filter((r) => !r.id.startsWith("L"));
  const ready = all.filter((r) => r.available).length;
  return (
    <ReportLayout
      title="Reports Hub"
      description={`${ready} of ${all.length} reports available. All reports are admin-only and cover every branch unless you filter one.`}
      notes={[
        "Filters (date range in IST days, branch, category, vehicle) combine on every report that shows them.",
        "CSV exports contain row-level data with plain numbers (no ₹) and are UTF-8 with BOM for Excel.",
        "\"vs previous period\" compares with the immediately preceding equivalent range: previous day, week, month-to-date or same-length window.",
      ]}
    >
      <div className="space-y-8" data-testid="reports-hub">
        {REPORT_SECTIONS.map((section) => (
          <section key={section.id}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">{section.title}</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {section.reports.map((r) => {
                const inner = (
                  <div
                    className={cn(
                      "flex h-full flex-col rounded-xl border bg-white p-4 shadow-sm",
                      r.available ? "border-neutral-200 group-hover:border-[#FF5F00]/60" : "border-dashed border-neutral-200 opacity-70",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-neutral-900">
                        {!r.id.startsWith("L") && <span className="mr-1.5 text-xs font-medium text-neutral-400">{r.id}</span>}
                        {r.title}
                      </p>
                      {r.available ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          Available <ChevronRight className="h-3 w-3" />
                        </span>
                      ) : (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">Coming soon</span>
                      )}
                    </div>
                    <p className="mt-1 flex-1 text-sm text-neutral-500">{r.description}</p>
                    {(r.filters?.length || r.csv || r.compare) && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {r.filters?.map((f) => (
                          <span key={f} className="rounded bg-neutral-50 px-1.5 py-0.5 text-[10px] uppercase text-neutral-500">
                            {f}
                          </span>
                        ))}
                        {r.csv && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-neutral-50 px-1.5 py-0.5 text-[10px] uppercase text-neutral-500">
                            <FileSpreadsheet className="h-3 w-3" /> csv
                          </span>
                        )}
                        {r.compare && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-neutral-50 px-1.5 py-0.5 text-[10px] uppercase text-neutral-500">
                            <GitCompare className="h-3 w-3" /> compare
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
                return r.available ? (
                  <Link key={r.id} to={r.path} className="group block" data-testid={`hub-${r.id}`}>
                    {inner}
                  </Link>
                ) : (
                  <div key={r.id} aria-disabled data-testid={`hub-${r.id}`}>
                    {inner}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </ReportLayout>
  );
};
