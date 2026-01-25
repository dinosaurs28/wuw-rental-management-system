import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ChevronRight, FileText } from "lucide-react";
import { managerDashboardService, type DamageReport } from "@/services/managerDashboard.service";

interface DamageReportsProps {
    reports?: DamageReport[];
    isLoading?: boolean;
}

export const DamageReports = ({ reports = [], isLoading = false }: DamageReportsProps) => {

    return (
        <Card className="border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
                <div className="flex items-center gap-2">
                    <CardTitle className="text-lg font-bold">Damage Reports</CardTitle>
                    {reports.filter(r => r.status === 'OPEN').length > 0 && (
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                    )}
                </div>
                <Button variant="ghost" size="sm" className="gap-1 text-neutral-500" asChild>
                    <Link to="/manager/damage-reports">
                        View All <ChevronRight className="w-4 h-4" />
                    </Link>
                </Button>
            </CardHeader>
            <CardContent className="p-0">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0 divide-x divide-y md:divide-y-0 text-center">
                    {/* Summary Stats - could be visualized better but keeping simple for now */}
                    <div className="p-4 bg-neutral-50/50 flex flex-col items-center justify-center gap-1">
                        <span className="text-2xl font-bold text-neutral-900">{reports.length}</span>
                        <span className="text-xs text-neutral-500 font-medium uppercase tracking-wide">Total Reports</span>
                    </div>
                    <div className="p-4 bg-neutral-50/50 flex flex-col items-center justify-center gap-1">
                        <span className="text-2xl font-bold text-red-600">{reports.filter(r => r.severity === 'CRITICAL' || r.severity === 'HIGH').length}</span>
                        <span className="text-xs text-neutral-500 font-medium uppercase tracking-wide">Critical / High</span>
                    </div>
                    <div className="p-4 bg-neutral-50/50 flex flex-col items-center justify-center gap-1">
                        <span className="text-2xl font-bold text-blue-600">{reports.filter(r => r.status === 'OPEN').length}</span>
                        <span className="text-xs text-neutral-500 font-medium uppercase tracking-wide">Open</span>
                    </div>
                </div>

                <div className="divide-y">
                    {isLoading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="p-4 flex items-center gap-4">
                                <Skeleton className="h-10 w-10 rounded-lg" />
                                <div className="space-y-2 flex-1">
                                    <Skeleton className="h-4 w-1/2" />
                                    <Skeleton className="h-3 w-1/3" />
                                </div>
                            </div>
                        ))
                    ) : reports.length === 0 ? (
                        <div className="p-8 text-center text-neutral-500">
                            No damage reports found.
                        </div>
                    ) : (
                        reports.slice(0, 3).map((report) => (
                            <Link
                                key={report.id}
                                to={`/damage-reports/${report.id}`}
                                className="flex items-center gap-4 p-4 hover:bg-neutral-50 transition-colors group"
                            >
                                <div className="w-10 h-10 rounded-lg bg-neutral-100 flex items-center justify-center shrink-0 group-hover:bg-white group-hover:shadow-sm transition-all border border-transparent group-hover:border-neutral-200">
                                    <AlertTriangle className={`w-5 h-5 ${report.severity === 'CRITICAL' ? 'text-red-600' :
                                        report.severity === 'HIGH' ? 'text-orange-600' :
                                            'text-yellow-600'
                                        }`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-semibold truncate text-neutral-900">{report.vehicleName}</h4>
                                    <p className="text-xs text-neutral-500 truncate">Reported by {report.reportedBy} • {new Date(report.createdAt).toLocaleDateString()}</p>
                                </div>
                                <div>
                                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${report.status === 'OPEN' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                        report.status === 'IN_PROGRESS' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                            'bg-green-50 text-green-700 border-green-200'
                                        }`}>
                                        {report.status.replace('_', ' ')}
                                    </span>
                                </div>
                            </Link>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
