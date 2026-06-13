import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  AlertTriangle,
  Search,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  managerDashboardService,
  type DamageReport,
} from "@/services/managerDashboard.service";
import { useDebounce } from "@/hooks/useDebounce";

const severityConfig = {
  CRITICAL: { label: "Critical", dot: "#dc2626", bg: "#fef2f2", border: "#fecaca", text: "#dc2626" },
  HIGH:     { label: "High",     dot: "#ea580c", bg: "#fff7ed", border: "#fed7aa", text: "#ea580c" },
  MEDIUM:   { label: "Medium",   dot: "#d97706", bg: "#fffbeb", border: "#fde68a", text: "#d97706" },
  LOW:      { label: "Low",      dot: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", text: "#16a34a" },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  PENDING:     { label: "Pending",     color: "#2563eb" },
  IN_PROGRESS: { label: "In Progress", color: "#d97706" },
  APPROVED:    { label: "Approved",    color: "#16a34a" },
  REJECTED:    { label: "Rejected",    color: "#6b7280" },
};

const PAGE_SIZE = 15;

export const DamageReportsPage = () => {
  const navigate = useNavigate();
  const [reports, setReports] = useState<DamageReport[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const debouncedSearch = useDebounce(search, 400);

  const load = useCallback(
    async (p: number) => {
      try {
        setIsLoading(true);
        const data = await managerDashboardService.getDamageReports(p, PAGE_SIZE, debouncedSearch);
        const filtered = statusFilter === "ALL"
          ? data
          : data.filter((r) => r.status === statusFilter);
        setReports(filtered);
        setHasMore(data.length >= PAGE_SIZE);
        setPage(p);
      } catch {
        toast.error("Failed to load damage reports");
      } finally {
        setIsLoading(false);
      }
    },
    [debouncedSearch, statusFilter],
  );

  useEffect(() => {
    setPage(1);
    load(1);
  }, [debouncedSearch, statusFilter, load]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await load(page);
    setIsRefreshing(false);
  };

  const pending = reports.filter((r) => r.status === "PENDING").length;
  const critical = reports.filter(
    (r) => r.severity === "CRITICAL" || r.severity === "HIGH",
  ).length;

  return (
    <ManagerLayout>
      <div className="min-h-screen" style={{ backgroundColor: "#F8F7F5" }}>
        <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-6 space-y-5">

          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <button
                className="flex items-center gap-1 text-[11px] font-semibold text-[#9ca3af] hover:text-[#6b6860] transition-colors mb-2"
                onClick={() => navigate("/manager/dashboard")}
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Dashboard
              </button>
              <p
                className="text-[10px] font-bold uppercase tracking-[0.18em] mb-1"
                style={{ color: "#9ca3af" }}
              >
                Reports
              </p>
              <h1
                className="text-2xl font-bold tracking-tight"
                style={{ color: "#1a1917" }}
              >
                Damage Reports
              </h1>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="gap-2 self-start sm:self-auto border-[#e8e6e1] bg-white text-[#6b6860] hover:text-[#1a1917] h-9"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* Summary strip */}
          <div className="grid grid-cols-3 rounded-2xl border border-[#e8e6e1] bg-white overflow-hidden divide-x divide-[#f0ede8]">
            {[
              { label: "Shown", value: reports.length, color: "#1a1917" },
              { label: "Critical / High", value: critical, color: "#dc2626" },
              { label: "Pending Action", value: pending, color: "#2563eb" },
            ].map(({ label, value, color }) => (
              <div key={label} className="py-4 text-center">
                <div className="font-mono text-2xl font-bold" style={{ color }}>{value}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9ca3af] mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {/* Search + filter */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 flex items-center gap-2 rounded-xl border border-[#e8e6e1] bg-white px-4 py-2.5">
              <Search className="w-4 h-4 text-[#9ca3af] shrink-0" />
              <Input
                placeholder="Search by vehicle name or report ID…"
                className="flex-1 border-none shadow-none focus-visible:ring-0 px-0 h-auto text-sm bg-transparent placeholder:text-[#c4c0bb]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v); }}>
              <SelectTrigger className="w-full sm:w-[180px] h-10 rounded-xl border-[#e8e6e1] bg-white text-sm text-[#1a1917]">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="rounded-2xl border border-[#e8e6e1] bg-white overflow-hidden">
            {isLoading ? (
              <div className="divide-y divide-[#f8f7f5]">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-6 py-4">
                    <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <Skeleton className="h-6 w-20 rounded-full" />
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                ))}
              </div>
            ) : reports.length === 0 ? (
              <div className="py-20 text-center">
                <CheckCircle2 className="w-10 h-10 text-green-300 mx-auto mb-3" />
                <p className="text-sm font-semibold text-[#6b6860]">No damage reports found</p>
                <p className="text-xs text-[#9ca3af] mt-1">
                  {search || statusFilter !== "ALL" ? "Try clearing your filters" : "All clear!"}
                </p>
              </div>
            ) : (
              <>
                {/* Desktop header */}
                <div className="hidden md:grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-6 py-3 border-b border-[#f0ede8] bg-[#fafaf9]">
                  {["Report", "Vehicle", "Severity", "Status", "Date"].map((h) => (
                    <span
                      key={h}
                      className="text-[10px] font-bold uppercase tracking-[0.12em]"
                      style={{ color: "#9ca3af" }}
                    >
                      {h}
                    </span>
                  ))}
                </div>

                <div className="divide-y divide-[#f8f7f5]">
                  {reports.map((report) => {
                    const sev = severityConfig[report.severity] ?? severityConfig.MEDIUM;
                    const sts = statusConfig[report.status] ?? statusConfig.PENDING;

                    return (
                      <button
                        key={report.id}
                        onClick={() => navigate(`/damage/${report.id}`)}
                        className="w-full text-left group"
                      >
                        {/* Mobile layout */}
                        <div className="md:hidden flex items-center gap-3 px-4 py-3.5 hover:bg-[#fafaf9] transition-colors">
                          <div
                            className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center border"
                            style={{ backgroundColor: sev.bg, borderColor: sev.border }}
                          >
                            {report.vehicleImage ? (
                              <img src={report.vehicleImage} alt="" className="w-full h-full object-cover rounded-lg" />
                            ) : (
                              <AlertTriangle className="w-4 h-4" style={{ color: sev.dot }} />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-mono text-[10px] text-[#9ca3af]">#{report.id}</span>
                              <span
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ color: sev.text, backgroundColor: sev.bg }}
                              >
                                {sev.label}
                              </span>
                            </div>
                            <p className="text-sm font-semibold text-[#1a1917] truncate">{report.vehicleName}</p>
                            <p className="text-[10px] text-[#9ca3af]">
                              {new Date(report.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                            </p>
                          </div>
                          <div
                            className="text-[10px] font-bold px-2 py-1 rounded-full border shrink-0"
                            style={{ color: sts.color, backgroundColor: sts.color + "12", borderColor: sts.color + "30" }}
                          >
                            {sts.label}
                          </div>
                          <ArrowRight className="w-3.5 h-3.5 text-[#d1cdc7] group-hover:text-[#e85d04] transition-colors shrink-0" />
                        </div>

                        {/* Desktop layout */}
                        <div className="hidden md:grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 items-center px-6 py-4 hover:bg-[#fafaf9] transition-colors">
                          {/* Report ID + thumbnail */}
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center border overflow-hidden"
                              style={{ backgroundColor: sev.bg, borderColor: sev.border }}
                            >
                              {report.vehicleImage ? (
                                <img src={report.vehicleImage} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <AlertTriangle className="w-4 h-4" style={{ color: sev.dot }} />
                              )}
                            </div>
                            <span className="font-mono text-xs font-bold text-[#9ca3af]">#{report.id}</span>
                          </div>

                          {/* Vehicle */}
                          <span className="text-sm font-semibold text-[#1a1917] truncate">{report.vehicleName}</span>

                          {/* Severity */}
                          <div
                            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-[10px] font-bold"
                            style={{ color: sev.text, backgroundColor: sev.bg, borderColor: sev.border }}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: sev.dot }}
                            />
                            {sev.label}
                          </div>

                          {/* Status */}
                          <div
                            className="text-[10px] font-bold px-2.5 py-1 rounded-full border"
                            style={{
                              color: sts.color,
                              backgroundColor: sts.color + "12",
                              borderColor: sts.color + "30",
                            }}
                          >
                            {sts.label}
                          </div>

                          {/* Date + arrow */}
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-[#9ca3af] font-mono whitespace-nowrap">
                              {new Date(report.createdAt).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                              })}
                            </span>
                            <ArrowRight className="w-3.5 h-3.5 text-[#d1cdc7] group-hover:text-[#e85d04] transition-colors" />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Pagination */}
          {(page > 1 || hasMore) && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#9ca3af] font-mono">Page {page}</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-[#e8e6e1] bg-white h-9"
                  disabled={page === 1 || isLoading}
                  onClick={() => load(page - 1)}
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-[#e8e6e1] bg-white h-9"
                  disabled={!hasMore || isLoading}
                  onClick={() => load(page + 1)}
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ManagerLayout>
  );
};
