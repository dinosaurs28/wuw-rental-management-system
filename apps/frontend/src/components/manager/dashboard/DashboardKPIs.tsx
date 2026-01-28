import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { KPIStats } from "@/services/managerDashboard.service";
import { CalendarClock, AlertCircle, AlertTriangle, Users } from "lucide-react";

interface DashboardKPIsProps {
    stats: KPIStats | null;
    isLoading: boolean;
}

export const DashboardKPIs = ({ stats, isLoading }: DashboardKPIsProps) => {
    const KPICard = ({
        title,
        value,
        icon: Icon,
        colorClass,
        bgClass
    }: {
        title: string;
        value: number | undefined;
        icon: any;
        colorClass: string;
        bgClass: string;
    }) => (
        <Card className="p-5 border shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm font-medium text-neutral-500 mb-1">{title}</p>
                    {isLoading ? (
                        <Skeleton className="h-9 w-16" />
                    ) : (
                        <h3 className="text-3xl font-bold tracking-tight">{value ?? 0}</h3>
                    )}
                </div>
                <div className={`p-3 rounded-lg ${bgClass}`}>
                    <Icon className={`w-5 h-5 ${colorClass}`} />
                </div>
            </div>
        </Card>
    );


    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
                title="Active Vehicles"
                value={stats?.activeVehicles}
                icon={CalendarClock}
                colorClass="text-emerald-600"
                bgClass="bg-emerald-50"
            />
            <KPICard
                title="Inactive Vehicles"
                value={stats?.inactiveVehicles}
                icon={AlertCircle}
                colorClass="text-neutral-600"
                bgClass="bg-neutral-100"
            />
            <KPICard
                title="In Maintenance"
                value={stats?.maintenanceVehicles}
                icon={Users} // Maybe Wrench/Tool icon better but sticking to imports for now or standard
                colorClass="text-orange-600"
                bgClass="bg-orange-50"
            />
            <KPICard
                title="Open Damage Reports"
                value={stats?.openDamageReports}
                icon={AlertTriangle}
                colorClass="text-red-600"
                bgClass="bg-red-50"
            />
        </div>
    );
};
