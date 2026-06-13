import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ArrowRight, Clock, CheckCircle2, Loader2 } from "lucide-react";
import { type DamageReport } from "@/services/managerDashboard.service";

interface DamageReportsProps {
  reports?: DamageReport[];
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoading?: boolean;
}

const severityConfig = {
  CRITICAL: { label: "Critical", dot: "#dc2626", bg: "#fef2f2", text: "#dc2626" },
  HIGH: { label: "High", dot: "#ea580c", bg: "#fff7ed", text: "#ea580c" },
  MEDIUM: { label: "Medium", dot: "#d97706", bg: "#fffbeb", text: "#d97706" },
  LOW: { label: "Low", dot: "#16a34a", bg: "#f0fdf4", text: "#16a34a" },
};

const statusConfig = {
  PENDING: { label: "Pending", icon: Clock, color: "#2563eb" },
  IN_PROGRESS: { label: "In Progress", icon: Loader2, color: "#d97706" },
  APPROVED: { label: "Approved", icon: CheckCircle2, color: "#16a34a" },
  REJECTED: { label: "Rejected", icon: CheckCircle2, color: "#6b7280" },
};

export const DamageReports = ({
  reports = [],
  isLoading = false,
  onLoadMore,
  hasMore = false,
}: DamageReportsProps) => {
  const navigate = useNavigate();
  const pending = reports.filter((r) => r.status === "PENDING").length;
  const critical = reports.filter((r) => r.severity === "CRITICAL" || r.severity === "HIGH").length;

  return (
    <div className="rounded-2xl border border-[#e8e6e1] bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0ede8]">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-red-50 border border-red-100 p-1.5">
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <div>
            <h2 className="font-bold text-[#1a1917] text-sm">Damage Reports</h2>
            <p className="text-[11px] text-[#9ca3af]">
              {pending > 0 ? (
                <span className="text-red-600 font-semibold">{pending} pending action</span>
              ) : (
                "All caught up"
              )}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="text-[#e85d04] hover:text-[#c2410c] hover:bg-orange-50 text-xs font-semibold gap-1 h-8 px-3"
          onClick={() => navigate("/manager/damage-reports")}
        >
          View All <ArrowRight className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Mini stats */}
      <div className="grid grid-cols-3 divide-x divide-[#f0ede8] border-b border-[#f0ede8]">
        {[
          { label: "Shown", value: reports.length, color: "#1a1917" },
          { label: "Critical / High", value: critical, color: "#dc2626" },
          { label: "Pending", value: pending, color: "#2563eb" },
        ].map(({ label, value, color }) => (
          <div key={label} className="py-3 text-center">
            <div className="font-mono text-xl font-bold" style={{ color }}>{value}</div>
            <div className="text-[10px] font-medium text-[#9ca3af] uppercase tracking-wide mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* List */}
      <div className="divide-y divide-[#f8f7f5]">
        {isLoading && reports.length === 0 ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
              <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))
        ) : reports.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-300 mx-auto mb-2" />
            <p className="text-sm text-[#9ca3af] font-medium">No damage reports</p>
          </div>
        ) : (
          reports.map((report) => {
            const sev = severityConfig[report.severity] ?? severityConfig.MEDIUM;
            const sts = statusConfig[report.status] ?? statusConfig.PENDING;
            const StatusIcon = sts.icon;

            return (
              <button
                key={report.id}
                onClick={() => navigate(`/damage/${report.id}`)}
                className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-[#fafaf9] transition-colors text-left group"
              >
                {/* Vehicle image / severity icon */}
                <div
                  className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center border overflow-hidden"
                  style={{ backgroundColor: sev.bg, borderColor: sev.dot + "30" }}
                >
                  {report.vehicleImage ? (
                    <img src={report.vehicleImage} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <AlertTriangle className="w-4 h-4" style={{ color: sev.dot }} />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: sev.dot }}
                    />
                    <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: sev.text }}>
                      {sev.label}
                    </span>
                    <span className="text-[#d1cdc7] text-[10px]">·</span>
                    <span className="font-mono text-[11px] text-[#9ca3af]">#{report.id}</span>
                  </div>
                  <p className="text-sm font-semibold text-[#1a1917] truncate">{report.vehicleName}</p>
                  <p className="text-[11px] text-[#9ca3af]">
                    {new Date(report.createdAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>

                {/* Status */}
                <div
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold border shrink-0"
                  style={{
                    color: sts.color,
                    backgroundColor: sts.color + "12",
                    borderColor: sts.color + "30",
                  }}
                >
                  <StatusIcon className="w-3 h-3" />
                  {sts.label}
                </div>

                <ArrowRight className="w-3.5 h-3.5 text-[#d1cdc7] group-hover:text-[#e85d04] transition-colors shrink-0" />
              </button>
            );
          })
        )}
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="border-t border-[#f0ede8] px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-[#6b6860] hover:text-[#1a1917] text-xs font-medium"
            onClick={onLoadMore}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
            Load more reports
          </Button>
        </div>
      )}
    </div>
  );
};
