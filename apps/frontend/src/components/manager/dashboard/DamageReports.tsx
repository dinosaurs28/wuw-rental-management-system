import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { type DamageReport } from "@/services/managerDashboard.service";

interface DamageReportsProps {
  reports?: DamageReport[];
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoading?: boolean;
}

export const DamageReports = ({
  reports = [],
  isLoading = false,
  onLoadMore,
  hasMore = false,
}: DamageReportsProps) => {
  return (
    <Card className="border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg font-bold">Damage Reports</CardTitle>
          {reports.filter((r) => r.status === "PENDING").length > 0 && (
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
          )}
        </div>
        {/* Removed View All link in favor of inline expansion */}
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0 divide-x divide-y md:divide-y-0 text-center border-b">
          <div className="p-4 bg-neutral-50/50 flex flex-col items-center justify-center gap-1">
            <span className="text-2xl font-bold text-neutral-900">
              {reports.length}
            </span>
            <span className="text-xs text-neutral-500 font-medium uppercase tracking-wide">
              Shown
            </span>
          </div>
          <div className="p-4 bg-neutral-50/50 flex flex-col items-center justify-center gap-1">
            <span className="text-2xl font-bold text-red-600">
              {
                reports.filter(
                  (r) => r.severity === "CRITICAL" || r.severity === "HIGH",
                ).length
              }
            </span>
            <span className="text-xs text-neutral-500 font-medium uppercase tracking-wide">
              Critical / High
            </span>
          </div>
          <div className="p-4 bg-neutral-50/50 flex flex-col items-center justify-center gap-1">
            <span className="text-2xl font-bold text-blue-600">
              {reports.filter((r) => r.status === "PENDING").length}
            </span>
            <span className="text-xs text-neutral-500 font-medium uppercase tracking-wide">
              Pending
            </span>
          </div>
        </div>

        <div className="divide-y max-h-[600px] overflow-y-auto">
          {reports.length === 0 && !isLoading ? (
            <div className="p-8 text-center text-neutral-500">
              No damage reports found.
            </div>
          ) : (
            reports.map((report) => (
              <Link
                key={report.id}
                to={`/damage/${report.id}`}
                className="flex items-center gap-4 p-4 hover:bg-neutral-50 transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-neutral-100 flex items-center justify-center shrink-0 group-hover:bg-white group-hover:shadow-sm transition-all border border-transparent group-hover:border-neutral-200 overflow-hidden relative">
                  {report.vehicleImage ? (
                    <img
                      src={report.vehicleImage}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <AlertTriangle
                      className={`w-5 h-5 ${
                        report.severity === "CRITICAL"
                          ? "text-red-600"
                          : report.severity === "HIGH"
                            ? "text-orange-600"
                            : "text-yellow-600"
                      }`}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold truncate text-neutral-900">
                    #{report.id} - {report.vehicleName}
                  </h4>
                  <p className="text-xs text-neutral-500 truncate">
                    Reported by {report.reportedBy} •{" "}
                    {new Date(report.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <span
                    className={`text-[10px] font-bold px-2 py-1 rounded-full border ${
                      report.status === "PENDING"
                        ? "bg-blue-50 text-blue-700 border-blue-200"
                        : report.status === "IN_PROGRESS"
                          ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                          : "bg-green-50 text-green-700 border-green-200"
                    }`}
                  >
                    {report.status.replace("_", " ")}
                  </span>
                </div>
              </Link>
            ))
          )}

          {isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-4 flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
        </div>
        {hasMore && (
          <div className="p-2 border-t bg-neutral-50">
            <Button
              variant="ghost"
              className="w-full text-neutral-500 hover:text-neutral-900"
              onClick={onLoadMore}
              disabled={isLoading}
            >
              <span className="flex items-center gap-2">
                Expand Down <ChevronRight className="w-4 h-4 rotate-90" />
              </span>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
