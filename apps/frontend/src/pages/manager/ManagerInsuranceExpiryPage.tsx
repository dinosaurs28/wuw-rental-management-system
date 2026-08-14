import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Car,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Pencil,
  X,
} from "lucide-react";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import {
  fetchInsuranceExpiryReport,
  type InsuranceExpiryReportItem,
} from "@/services/vehicle.service";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";

const PAGE_SIZE = 20;

type StatusFilter = "" | "expired" | "expiring_soon" | "valid";

function getExpiryMeta(dateString: string | null) {
  if (!dateString) return { label: "No Data", days: null, variant: "none" as const };
  const days = differenceInDays(new Date(dateString), new Date());
  if (days < 0) return { label: "Expired", days, variant: "expired" as const };
  if (days <= 30) return { label: "Expiring Soon", days, variant: "soon" as const };
  return { label: "Valid", days, variant: "valid" as const };
}

const variantStyles = {
  expired: {
    badge: "bg-red-100 text-red-700 border border-red-200",
    dot: "bg-red-500",
    row: "bg-red-50/30",
    countdown: "text-red-600 bg-red-50 border-red-200",
  },
  soon: {
    badge: "bg-amber-100 text-amber-700 border border-amber-200",
    dot: "bg-amber-500",
    row: "bg-amber-50/20",
    countdown: "text-amber-600 bg-amber-50 border-amber-200",
  },
  valid: {
    badge: "bg-green-100 text-green-700 border border-green-200",
    dot: "bg-green-500",
    row: "",
    countdown: "text-green-600 bg-green-50 border-green-200",
  },
  none: {
    badge: "bg-neutral-100 text-neutral-500 border border-neutral-200",
    dot: "bg-neutral-400",
    row: "",
    countdown: "text-neutral-500 bg-neutral-50 border-neutral-200",
  },
};

export const ManagerInsuranceExpiryPage = () => {
  const navigate = useNavigate();
  const [reports, setReports] = useState<InsuranceExpiryReportItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ expired: 0, expiringSoon: 0 });

  const load = useCallback(async (p: number, q: string, s: StatusFilter) => {
    setIsLoading(true);
    try {
      const res = await fetchInsuranceExpiryReport({ search: q || undefined, status: s || undefined, page: p, limit: PAGE_SIZE });
      setReports(res.data);
      setTotal(res.total);
      setSummary(res.summary);
    } catch {
      toast.error("Failed to load insurance data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      load(1, searchTerm, statusFilter);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Status filter immediate
  useEffect(() => {
    setPage(1);
    load(1, searchTerm, statusFilter);
  }, [statusFilter]);

  // Page change
  useEffect(() => {
    load(page, searchTerm, statusFilter);
  }, [page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilters = !!searchTerm || !!statusFilter;

  const clearFilters = () => {
    setSearchTerm("");
    setStatusFilter("");
  };

  return (
    <ManagerLayout>
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12 space-y-6">

        {/* Header */}
        <div>
          <Breadcrumb className="mb-3">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="/manager/vehicles">Vehicles</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Insurance Alerts</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">
                Insurance Alerts
              </h1>
              <p className="text-sm text-neutral-500 mt-1">
                Track and manage vehicle insurance expiry across your fleet.
              </p>
            </div>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs shrink-0" onClick={() => load(page, searchTerm, statusFilter)} disabled={isLoading}>
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        {/* KPI Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Expired */}
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === "expired" ? "" : "expired")}
            className={`text-left rounded-xl border p-4 transition-all ${statusFilter === "expired" ? "border-red-400 bg-red-50 ring-2 ring-red-200" : "border-neutral-200 bg-white hover:border-red-200 hover:bg-red-50/40"}`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center">
                <ShieldX className="w-4.5 h-4.5 text-red-600" style={{ width: 18, height: 18 }} />
              </div>
              {statusFilter === "expired" && (
                <span className="text-[10px] font-semibold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">Filtered</span>
              )}
            </div>
            <p className="text-2xl font-bold text-red-700 tabular-nums">{summary.expired}</p>
            <p className="text-xs text-red-500/80 font-medium mt-0.5">Expired</p>
          </button>

          {/* Expiring Soon */}
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === "expiring_soon" ? "" : "expiring_soon")}
            className={`text-left rounded-xl border p-4 transition-all ${statusFilter === "expiring_soon" ? "border-amber-400 bg-amber-50 ring-2 ring-amber-200" : "border-neutral-200 bg-white hover:border-amber-200 hover:bg-amber-50/40"}`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center">
                <ShieldAlert className="w-4.5 h-4.5 text-amber-600" style={{ width: 18, height: 18 }} />
              </div>
              {statusFilter === "expiring_soon" && (
                <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">Filtered</span>
              )}
            </div>
            <p className="text-2xl font-bold text-amber-700 tabular-nums">{summary.expiringSoon}</p>
            <p className="text-xs text-amber-500/80 font-medium mt-0.5">Expiring within 30 days</p>
          </button>

          {/* Valid */}
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === "valid" ? "" : "valid")}
            className={`text-left rounded-xl border p-4 transition-all ${statusFilter === "valid" ? "border-green-400 bg-green-50 ring-2 ring-green-200" : "border-neutral-200 bg-white hover:border-green-200 hover:bg-green-50/40"}`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center">
                <ShieldCheck className="w-4.5 h-4.5 text-green-600" style={{ width: 18, height: 18 }} />
              </div>
              {statusFilter === "valid" && (
                <span className="text-[10px] font-semibold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">Filtered</span>
              )}
            </div>
            <p className="text-2xl font-bold text-green-700 tabular-nums">{Math.max(0, total - summary.expired - summary.expiringSoon)}</p>
            <p className="text-xs text-green-500/80 font-medium mt-0.5">Valid (30+ days)</p>
          </button>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-xl border border-neutral-200 px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
            <Input
              placeholder="Search vehicle or reg number…"
              className="pl-9 h-9 text-sm bg-neutral-50 border-neutral-200"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={statusFilter || "__all__"} onValueChange={(v) => setStatusFilter(v === "__all__" ? "" : v as StatusFilter)}>
            <SelectTrigger className="h-9 w-44 text-sm">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              <SelectItem value="__all__">All Statuses</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="expiring_soon">Expiring Soon</SelectItem>
              <SelectItem value="valid">Valid</SelectItem>
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-9 text-neutral-500 gap-1.5 text-xs" onClick={clearFilters}>
              <X className="w-3.5 h-3.5" /> Clear
            </Button>
          )}
          {total > 0 && !isLoading && (
            <span className="ml-auto text-xs text-neutral-500 hidden sm:block">
              {total} vehicle{total !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-neutral-100">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-lg bg-neutral-100 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-32" />
                    <div className="h-3 bg-neutral-100 rounded animate-pulse w-20" />
                  </div>
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-28 hidden md:block" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-24 hidden md:block" />
                  <div className="h-3.5 bg-neutral-100 rounded animate-pulse w-24 hidden lg:block" />
                  <div className="h-6 bg-neutral-100 rounded-full animate-pulse w-20" />
                  <div className="h-8 bg-neutral-100 rounded-lg animate-pulse w-8" />
                </div>
              ))}
            </div>
          ) : reports.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mb-3">
                <ShieldCheck className="w-6 h-6 text-neutral-400" />
              </div>
              <p className="font-medium text-neutral-700">
                {hasFilters ? "No vehicles match your filters" : "No insurance records found"}
              </p>
              <p className="text-sm text-neutral-400 mt-1">
                {hasFilters ? "Try clearing the filters to see all vehicles." : "Add insurance details to vehicles to track them here."}
              </p>
              {hasFilters && (
                <Button variant="outline" size="sm" className="mt-4 gap-1.5 text-xs h-8" onClick={clearFilters}>
                  <X className="w-3 h-3" /> Clear filters
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50/80">
                      {["Vehicle", "Policy Number", "Provider", "Expiry Date", "Days Left", "Status", ""].map((h, i) => (
                        <th key={i} className={`px-5 py-3.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide ${h === "" ? "w-12" : "text-left"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {reports.map((item) => {
                      const meta = getExpiryMeta(item.expiryDate);
                      const styles = variantStyles[meta.variant];
                      return (
                        <tr key={item.publicId} className={`transition-colors hover:bg-neutral-50/60 ${styles.row}`}>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-neutral-100 overflow-hidden shrink-0 border border-neutral-200/60">
                                {item.thumbnail ? (
                                  <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-neutral-300">
                                    <Car className="w-4 h-4" />
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className="font-medium text-neutral-900 text-sm">{item.vehicleName}</p>
                                <p className="text-xs text-neutral-400 font-mono mt-0.5">{item.regNo}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs text-neutral-500">{item.policyNumber}</td>
                          <td className="px-5 py-3.5 text-sm text-neutral-600">{item.provider}</td>
                          <td className="px-5 py-3.5 text-sm text-neutral-700 whitespace-nowrap">
                            {item.expiryDate ? format(new Date(item.expiryDate), "dd MMM yyyy") : "—"}
                          </td>
                          <td className="px-5 py-3.5">
                            {meta.days !== null ? (
                              <span className={`inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles.countdown}`}>
                                {meta.days < 0 ? `${Math.abs(meta.days)}d ago` : meta.days === 0 ? "Today" : `${meta.days}d`}
                              </span>
                            ) : <span className="text-neutral-300">—</span>}
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${styles.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-neutral-400 hover:text-neutral-700"
                              onClick={() => navigate(`/manager/vehicles/edit/${item.publicId}`)}
                              title="Edit vehicle"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-neutral-100">
                {reports.map((item) => {
                  const meta = getExpiryMeta(item.expiryDate);
                  const styles = variantStyles[meta.variant];
                  return (
                    <div key={item.publicId} className={`px-4 py-4 ${styles.row}`}>
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-11 h-11 rounded-lg bg-neutral-100 overflow-hidden shrink-0 border border-neutral-200/60">
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-neutral-300">
                              <Car className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-neutral-900 text-sm">{item.vehicleName}</p>
                          <p className="text-xs text-neutral-400 font-mono">{item.regNo}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {meta.days !== null && (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${styles.countdown}`}>
                              {meta.days < 0 ? `${Math.abs(meta.days)}d ago` : meta.days === 0 ? "Today" : `${meta.days}d`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-neutral-400">Policy</span>
                          <span className="font-mono text-neutral-600">{item.policyNumber}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-400">Provider</span>
                          <span className="text-neutral-700">{item.provider}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-400">Expiry</span>
                          <span className="text-neutral-700">{item.expiryDate ? format(new Date(item.expiryDate), "dd MMM yyyy") : "—"}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-neutral-100">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${styles.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
                          {meta.label}
                        </span>
                        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => navigate(`/manager/vehicles/edit/${item.publicId}`)}>
                          <Pencil className="w-3 h-3" /> Update
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-500">
              Showing{" "}
              <span className="font-medium text-neutral-700">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}</span>
              {" "}of{" "}
              <span className="font-medium text-neutral-700">{total}</span> vehicles
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1 || isLoading} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-neutral-600 px-2">Page {page} of {totalPages}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages || isLoading} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </ManagerLayout>
  );
};
